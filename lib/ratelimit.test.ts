import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Подменяем kv-модуль: тесты не ходят в сеть. Флагом kvUp имитируем «стор настроен/нет».
const kvMock = {
  setIfAbsent: vi.fn<(key: string, ttl: number) => Promise<boolean>>(),
  bumpCounter: vi.fn<(key: string, ttl: number) => Promise<number>>(),
};
let kvUp = true;

vi.mock("./kv", () => ({
  getKv: () => (kvUp ? kvMock : null),
  kvConfig: () => (kvUp ? { url: "https://kv.test", token: "t" } : null),
}));

const { allowCrank, allowAuth, rateLimitBackend, clientKey, __testing } = await import(
  "./ratelimit"
);

beforeEach(() => {
  kvUp = true;
  kvMock.setIfAbsent.mockReset();
  kvMock.bumpCounter.mockReset();
});

describe("kvWindow (фиксированное окно в общем сторе)", () => {
  it("кладёт номер окна в ключ и ставит TTL в длину окна", async () => {
    kvMock.bumpCounter.mockResolvedValue(1);
    await __testing.kvWindow(kvMock, "p:auth:1.2.3.4", 30, 60_000, 90_000);
    // 90_000 / 60_000 = 1 → окно №1, TTL 60 секунд.
    expect(kvMock.bumpCounter).toHaveBeenCalledWith("p:auth:1.2.3.4:1", 60);
  });

  it("пропускает до лимита включительно и режет сверх него", async () => {
    kvMock.bumpCounter.mockResolvedValue(30);
    expect(await __testing.kvWindow(kvMock, "k", 30, 60_000, 0)).toBe(true);
    kvMock.bumpCounter.mockResolvedValue(31);
    expect(await __testing.kvWindow(kvMock, "k", 30, 60_000, 0)).toBe(false);
  });

  it("на новом окне счётчик другой ключ (лимит обнуляется)", async () => {
    kvMock.bumpCounter.mockResolvedValue(1);
    await __testing.kvWindow(kvMock, "k", 30, 60_000, 59_999);
    await __testing.kvWindow(kvMock, "k", 30, 60_000, 60_000);
    expect(kvMock.bumpCounter.mock.calls[0][0]).toBe("k:0");
    expect(kvMock.bumpCounter.mock.calls[1][0]).toBe("k:1");
  });
});

describe("allowCrank", () => {
  it("через общий стор: атомарный SET NX с TTL в 1 секунду", async () => {
    kvMock.setIfAbsent.mockResolvedValue(true);
    expect(await allowCrank("wallet:0xabc", 1_000)).toBe(true);
    expect(kvMock.setIfAbsent).toHaveBeenCalledWith("vltr:rl:crank:wallet:0xabc", 1);
  });

  it("отказ, если ключ уже стоит (кранк чаще секунды)", async () => {
    kvMock.setIfAbsent.mockResolvedValue(false);
    expect(await allowCrank("wallet:0xabc", 1_000)).toBe(false);
  });
});

describe("откат в память процесса", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("стор не настроен → лимит всё равно работает", async () => {
    kvUp = false;
    const id = "dev:no-kv";
    expect(await allowCrank(id, 10_000)).toBe(true);
    expect(await allowCrank(id, 10_500)).toBe(false); // < 1с
    expect(await allowCrank(id, 11_000)).toBe(true);
    expect(kvMock.setIfAbsent).not.toHaveBeenCalled();
  });

  it("стор отвалился → не роняем запрос, считаем в памяти", async () => {
    kvMock.setIfAbsent.mockRejectedValue(new Error("ECONNREFUSED"));
    const id = "dev:kv-down";
    expect(await allowCrank(id, 20_000)).toBe(true);
    expect(await allowCrank(id, 20_100)).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it("ошибка стора в оконном лимитере тоже не пробрасывается наружу", async () => {
    kvMock.bumpCounter.mockRejectedValue(new Error("kv http 500"));
    await expect(allowAuth("9.9.9.9", 30_000)).resolves.toBe(true);
  });
});

describe("memoryWindow", () => {
  it("режет по лимиту и отпускает после окна", () => {
    const allow = __testing.memoryWindow(2, 1_000);
    expect(allow("ip", 0)).toBe(true);
    expect(allow("ip", 100)).toBe(true);
    expect(allow("ip", 200)).toBe(false); // лимит 2 исчерпан
    expect(allow("ip", 1_200)).toBe(true); // первые две записи вышли из окна
  });

  it("ключи независимы", () => {
    const allow = __testing.memoryWindow(1, 1_000);
    expect(allow("a", 0)).toBe(true);
    expect(allow("b", 0)).toBe(true);
    expect(allow("a", 0)).toBe(false);
  });
});

describe("rateLimitBackend", () => {
  it("сообщает, общие ли счётчики (для /api/health)", () => {
    kvUp = true;
    expect(rateLimitBackend()).toBe("shared");
    kvUp = false;
    expect(rateLimitBackend()).toBe("memory");
  });
});

describe("clientKey — ключ берётся только из доверенного источника", () => {
  const withHeaders = (headers: Record<string, string>, identity?: string) =>
    clientKey(new Request("https://x.test", { headers }), identity);

  /**
   * Раньше ключом служил ПЕРВЫЙ элемент X-Forwarded-For, а его присылает сам клиент.
   * Меняя его в каждом запросе, атакующий попадал в свежий пустой счётчик — лимитера
   * фактически не было (проверено вживую: 45 запросов при лимите 40/мин прошли все).
   */
  it("клиентский X-Forwarded-For больше не влияет на ключ", () => {
    const a = withHeaders({ "x-forwarded-for": "10.0.0.1" }, "dev:same");
    const b = withHeaders({ "x-forwarded-for": "10.0.0.2" }, "dev:same");
    expect(a).toBe(b); // подделка не даёт нового ведра
  });

  it("подделка X-Forwarded-For не перебивает заголовок платформы", () => {
    expect(
      withHeaders({ "x-forwarded-for": "9.9.9.9", "x-vercel-forwarded-for": "203.0.113.7" }),
    ).toBe("ip:203.0.113.7");
  });

  it("x-real-ip тоже доверенный источник", () => {
    expect(withHeaders({ "x-forwarded-for": "9.9.9.9", "x-real-ip": "10.0.0.1" })).toBe(
      "ip:10.0.0.1",
    );
  });

  it("без доверенного IP ключуем по сессии, а не общим ведром на всех", () => {
    // Общее ведро значило бы, что один флудер выбирает лимит за всех честных игроков.
    expect(withHeaders({}, "wallet:0xabc")).toBe("sid:wallet:0xabc");
    expect(withHeaders({})).toBe("unknown");
  });

  it("разные доверенные IP — разные вёдра", () => {
    expect(withHeaders({ "x-real-ip": "10.0.0.1" })).not.toBe(
      withHeaders({ "x-real-ip": "10.0.0.2" }),
    );
  });
});

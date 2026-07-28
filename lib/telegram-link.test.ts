/**
 * Одноразовый код привязки Telegram: должен работать РОВНО один раз, протухать за
 * 10 минут, инвалидировать предыдущий код при перевыпуске — и делать всё это что с
 * настоящим KV, что в фолбэке на память процесса (когда KV не настроен, как в dev).
 *
 * KV подменяем так же, как lib/ratelimit.test.ts: `kvUp` переключает, возвращает ли
 * `getKv()` мок или `null` (форсируя фолбэк в память).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LinkTelegramResult } from "./store";

const kvMock = {
  setIfAbsent: vi.fn(),
  bumpCounter: vi.fn(),
  setValue: vi.fn<(key: string, value: string, ttlSec: number) => Promise<void>>(),
  getAndDelete: vi.fn<(key: string) => Promise<string | null>>(),
};
let kvUp = true;

vi.mock("./kv", () => ({
  getKv: () => (kvUp ? kvMock : null),
}));

const {
  issueLinkCode,
  consumeLinkCode,
  completeLink,
  toLinkStatusView,
  resetTelegramLinkMemoryForTests,
} = await import("./telegram-link");

/** Мини-Redis в памяти теста — чтобы проверять реальную семантику GETDEL/SET EX. */
function wireFakeRedis() {
  const data = new Map<string, string>();
  kvMock.setValue.mockImplementation(async (k: string, v: string) => {
    data.set(k, v);
  });
  kvMock.getAndDelete.mockImplementation(async (k: string) => {
    const v = data.get(k) ?? null;
    data.delete(k);
    return v;
  });
  return data;
}

beforeEach(() => {
  kvUp = true;
  kvMock.setValue.mockReset();
  kvMock.getAndDelete.mockReset();
  resetTelegramLinkMemoryForTests();
});

describe("issueLinkCode / consumeLinkCode — с общим стором (KV)", () => {
  it("код одноразовый: второй consumeLinkCode с тем же кодом не находит ничего", async () => {
    wireFakeRedis();
    const { code } = await issueLinkCode("dev:a", 1000);
    expect(await consumeLinkCode(code, 1000)).toBe("dev:a");
    expect(await consumeLinkCode(code, 1000)).toBeNull();
  });

  it("неверный код не находит записи", async () => {
    wireFakeRedis();
    await issueLinkCode("dev:a", 1000);
    expect(await consumeLinkCode("0".repeat(32), 1000)).toBeNull();
  });

  it("перевыпуск кода гасит предыдущий (задание: «новый код инвалидирует предыдущий»)", async () => {
    wireFakeRedis();
    const first = await issueLinkCode("dev:a", 1000);
    const second = await issueLinkCode("dev:a", 1100);
    expect(first.code).not.toBe(second.code);
    expect(await consumeLinkCode(first.code, 1200)).toBeNull();
    expect(await consumeLinkCode(second.code, 1200)).toBe("dev:a");
  });

  it("TTL кода — 600 секунд (10 минут из задания)", async () => {
    wireFakeRedis();
    await issueLinkCode("dev:a", 1000);
    const ttls = kvMock.setValue.mock.calls.map(([, , ttl]) => ttl);
    expect(ttls.every((t) => t === 600)).toBe(true);
  });

  it("код 128 бит энтропии — 32 hex-символа", async () => {
    wireFakeRedis();
    const { code } = await issueLinkCode("dev:a", 1000);
    expect(code).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("фолбэк в память процесса (KV не настроен — как в dev без Upstash)", () => {
  beforeEach(() => {
    kvUp = false;
  });

  it("одноразовость сохраняется и без KV", async () => {
    const { code } = await issueLinkCode("dev:a", 1000);
    expect(await consumeLinkCode(code, 1000)).toBe("dev:a");
    expect(await consumeLinkCode(code, 1000)).toBeNull();
  });

  it("код внутри TTL (599 c) проходит", async () => {
    const { code } = await issueLinkCode("dev:a", 1000);
    expect(await consumeLinkCode(code, 1000 + 599_000)).toBe("dev:a");
  });

  it("протухший код (>600 c) не проходит", async () => {
    const { code } = await issueLinkCode("dev:a", 1000);
    expect(await consumeLinkCode(code, 1000 + 601_000)).toBeNull();
  });

  it("перевыпуск инвалидирует старый и в фолбэке тоже", async () => {
    const first = await issueLinkCode("dev:a", 1000);
    const second = await issueLinkCode("dev:a", 1100);
    expect(await consumeLinkCode(first.code, 1200)).toBeNull();
    expect(await consumeLinkCode(second.code, 1200)).toBe("dev:a");
  });
});

describe("completeLink — оркестрация погашения кода + привязки в сторе", () => {
  beforeEach(() => {
    kvUp = false; // логика одинакова, фолбэк проще настраивать без мок-Redis
  });

  it("валидный код: погашает код и вызывает store.linkTelegram с распакованным identity", async () => {
    const { code } = await issueLinkCode("wallet:0xabc", 1000);
    const linkTelegram = vi
      .fn<(identity: string, chatId: number, now: number) => Promise<LinkTelegramResult>>()
      .mockResolvedValue({ displacedChatId: null });
    const store = { linkTelegram } as unknown as Parameters<typeof completeLink>[0];

    const res = await completeLink(store, 555, code, 1000);
    expect(res).toEqual({ ok: true, displacedChatId: null });
    expect(linkTelegram).toHaveBeenCalledWith("wallet:0xabc", 555, 1000);

    // Код именно погашен — повторная привязка тем же кодом больше невозможна.
    expect(await consumeLinkCode(code, 1000)).toBeNull();
  });

  it("прокидывает displacedChatId наверх — роут обязан уведомить старый чат", async () => {
    const { code } = await issueLinkCode("wallet:0xabc", 1000);
    const store = {
      linkTelegram: vi.fn().mockResolvedValue({ displacedChatId: 4242 }),
    } as unknown as Parameters<typeof completeLink>[0];
    const res = await completeLink(store, 555, code, 1000);
    expect(res.displacedChatId).toBe(4242);
  });

  it("неверный/просроченный код: ok:false, стор не трогается вообще", async () => {
    const store = { linkTelegram: vi.fn() } as unknown as Parameters<typeof completeLink>[0];
    const res = await completeLink(store, 555, "not-a-real-code", 1000);
    expect(res).toEqual({ ok: false, error: "invalid_code", displacedChatId: null });
    expect(store.linkTelegram).not.toHaveBeenCalled();
  });
});

describe("toLinkStatusView — форма ответа GET /api/telegram/link никогда не содержит chatId", () => {
  it("привязан → { linked: true }, ключа chatId в объекте нет", () => {
    const view = toLinkStatusView(123456789);
    expect(view).toEqual({ linked: true });
    expect(Object.keys(view)).not.toContain("chatId");
    expect(JSON.stringify(view)).not.toContain("123456789");
  });

  it("не привязан → { linked: false }", () => {
    expect(toLinkStatusView(null)).toEqual({ linked: false });
  });
});

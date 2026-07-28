/**
 * `setValue`/`getAndDelete` — примитивы, добавленные для одноразовых кодов привязки
 * Telegram (lib/telegram-link.ts). Остальной клиент (setIfAbsent/bumpCounter) уже
 * покрыт косвенно через lib/ratelimit.test.ts; здесь проверяем именно новые методы и
 * то, что они шлют РОВНО те команды Redis, на которые рассчитана одноразовость кода.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getKv, resetKvForTests } from "./kv";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.KV_REST_API_URL = "https://kv.test";
  process.env.KV_REST_API_TOKEN = "token";
  resetKvForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetKvForTests();
  vi.unstubAllGlobals();
});

function stubFetch(result: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => result,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("setValue — SET key value EX ttl", () => {
  it("шлёт ровно эту команду", async () => {
    const fetchMock = stubFetch({ result: "OK" });
    await getKv()!.setValue("k", "v", 600);
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(["SET", "k", "v", "EX", "600"]);
  });

  it("бросает исключение, если Redis вернул error", async () => {
    stubFetch({ error: "WRONGTYPE" });
    await expect(getKv()!.setValue("k", "v", 600)).rejects.toThrow();
  });
});

describe("getAndDelete — GETDEL key (одноразовое чтение)", () => {
  it("шлёт GETDEL и возвращает значение", async () => {
    const fetchMock = stubFetch({ result: "the-value" });
    const v = await getKv()!.getAndDelete("k");
    expect(v).toBe("the-value");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual(["GETDEL", "k"]);
  });

  it("null, если ключа не было (код уже использован или протух)", async () => {
    stubFetch({ result: null });
    expect(await getKv()!.getAndDelete("k")).toBeNull();
  });

  it("бросает исключение при ошибке Redis, а не тихо возвращает null", async () => {
    stubFetch({ error: "ERR something" });
    await expect(getKv()!.getAndDelete("k")).rejects.toThrow();
  });
});

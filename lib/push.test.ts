/**
 * Конфигурация фичи веб-пушей и поведение отправки.
 *
 * Ключевое требование: фича выключена ЦЕЛИКОМ, пока не задан полный набор env — иначе на
 * сайте есть кнопка, игрок её жмёт, подписка копится, а уведомления не доходят, и выглядит
 * это как «игра про меня забыла».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import { publicKeyForClient, pushConfigured, pushStatus, sendWebPush, vapidKeys } from "./push";

const ORIGINAL_ENV = { ...process.env };

const PAIR = (() => {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return {
    publicKey: e.getPublicKey().toString("base64url"),
    privateKey: e.getPrivateKey().toString("base64url"),
  };
})();

const TARGET = (() => {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return {
    endpoint: "https://push.example.com/send/abc",
    p256dh: e.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
})();

function configureAll() {
  process.env.VAPID_PUBLIC_KEY = PAIR.publicKey;
  process.env.VAPID_PRIVATE_KEY = PAIR.privateKey;
  process.env.VAPID_SUBJECT = "mailto:owner@example.com";
  process.env.CRON_SECRET = "0123456789abcdef";
}

beforeEach(() => {
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe("pushStatus/pushConfigured — фича включается только полным набором env", () => {
  it("ничего не задано → off", () => {
    expect(pushStatus()).toBe("off");
    expect(pushConfigured()).toBe(false);
  });

  it("только публичный ключ → misconfigured, а не «частично работает»", () => {
    process.env.VAPID_PUBLIC_KEY = PAIR.publicKey;
    expect(pushStatus()).toBe("misconfigured");
    expect(pushConfigured()).toBe(false);
  });

  it("ключи есть, контакта нет → misconfigured (push-сервисы отвергают JWT без sub)", () => {
    process.env.VAPID_PUBLIC_KEY = PAIR.publicKey;
    process.env.VAPID_PRIVATE_KEY = PAIR.privateKey;
    process.env.CRON_SECRET = "0123456789abcdef";
    expect(pushStatus()).toBe("misconfigured");
  });

  it("контакт не mailto:/https: → не считается заданным", () => {
    configureAll();
    process.env.VAPID_SUBJECT = "owner@example.com";
    expect(pushStatus()).toBe("misconfigured");
  });

  it("нет CRON_SECRET → misconfigured: подписки копились бы, а рассылка отвечала бы 401", () => {
    configureAll();
    delete process.env.CRON_SECRET;
    expect(pushStatus()).toBe("misconfigured");
  });

  it("ключ неверной длины не считается заданным (опечатка ловится здоровьем, а не игроком)", () => {
    configureAll();
    process.env.VAPID_PUBLIC_KEY = "BBBB";
    expect(vapidKeys()).toBe(null);
    expect(pushStatus()).toBe("misconfigured");
  });

  it("полный корректный набор → on, публичный ключ отдаётся клиенту", () => {
    configureAll();
    expect(pushStatus()).toBe("on");
    expect(pushConfigured()).toBe(true);
    expect(publicKeyForClient()).toBe(PAIR.publicKey);
  });

  it("выключенная фича не отдаёт публичный ключ", () => {
    expect(publicKeyForClient()).toBe(null);
  });
});

describe("sendWebPush", () => {
  beforeEach(configureAll);

  it("без конфигурации сеть не трогаем вовсе", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendWebPush(TARGET, "{}")).toEqual({ ok: false, gone: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("201 → ok, тело зашифровано (aes128gcm) и подписано VAPID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, headers: new Headers() });
    vi.stubGlobal("fetch", fetchMock);

    const res = await sendWebPush(TARGET, '{"title":"hi"}', 1234);
    expect(res).toMatchObject({ ok: true, gone: false });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(TARGET.endpoint);
    expect(init.headers["content-encoding"]).toBe("aes128gcm");
    expect(init.headers.ttl).toBe("1234");
    expect(init.headers.authorization.startsWith("vapid t=")).toBe(true);
    // Открытого текста в теле быть не должно: push-сервис передаёт байты, не читая их.
    expect(Buffer.from(init.body).includes("title")).toBe(false);
  });

  it("404 и 410 → gone: подписку обязан удалить вызывающий код", async () => {
    for (const status of [404, 410]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, headers: new Headers() }));
      expect(await sendWebPush(TARGET, "{}")).toMatchObject({ ok: false, gone: true });
    }
  });

  it("429 → retryAfterSec из заголовка, подписка не считается мёртвой", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        headers: new Headers({ "retry-after": "42" }),
      }),
    );
    expect(await sendWebPush(TARGET, "{}")).toMatchObject({
      ok: false,
      gone: false,
      retryAfterSec: 42,
    });
  });

  it("прочий отказ (500) — не gone: чужая авария не должна удалять живую подписку", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers() }));
    expect(await sendWebPush(TARGET, "{}")).toMatchObject({ ok: false, gone: false });
  });

  it("сетевая ошибка/таймаут не бросает исключение наружу", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ETIMEDOUT")));
    await expect(sendWebPush(TARGET, "{}")).resolves.toEqual({ ok: false, gone: false });
  });

  it("битые ключи подписки → gone (запись непригодна, а не сервис недоступен)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendWebPush({ ...TARGET, p256dh: "BBBB" }, "{}");
    expect(res).toEqual({ ok: false, gone: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

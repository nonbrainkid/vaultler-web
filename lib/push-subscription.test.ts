/**
 * Валидация подписки, пришедшей от клиента.
 *
 * Главное, что здесь проверяется, — не «формат красивый», а что endpoint нельзя превратить в
 * адрес внутренней сети: по этому URL наш сервер сам делает POST каждые 10 минут, то есть
 * непроверенный endpoint = SSRF по расписанию с нашего IP.
 */
import { describe, expect, it } from "vitest";
import { createECDH, randomBytes } from "node:crypto";
import {
  endpointFingerprint,
  isAllowedEndpoint,
  parseEndpointOnly,
  parseSubscription,
} from "./push-subscription";

const P256DH = (() => {
  const e = createECDH("prime256v1");
  e.generateKeys();
  return e.getPublicKey().toString("base64url");
})();
const AUTH = randomBytes(16).toString("base64url");
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abcDEF123";

function subBody(over: Record<string, unknown> = {}) {
  return { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH }, ...over };
}

describe("isAllowedEndpoint — адрес НАШЕГО исходящего запроса", () => {
  it("нормальный https-эндпоинт push-сервиса проходит", () => {
    expect(isAllowedEndpoint(ENDPOINT)).toBe(true);
    expect(isAllowedEndpoint("https://updates.push.services.mozilla.com/wpush/v2/gAAA")).toBe(true);
  });

  it("http (без TLS) — нет: тело пуша шифровано, но заголовок VAPID уходил бы открытым", () => {
    expect(isAllowedEndpoint("http://fcm.googleapis.com/fcm/send/x")).toBe(false);
  });

  it("localhost и .local — нет", () => {
    expect(isAllowedEndpoint("https://localhost/x")).toBe(false);
    expect(isAllowedEndpoint("https://printer.local/x")).toBe(false);
    expect(isAllowedEndpoint("https://db.internal/x")).toBe(false);
  });

  it("IP-литерал — нет (метаданные облака и внутренняя сеть адресуются только так)", () => {
    expect(isAllowedEndpoint("https://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isAllowedEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedEndpoint("https://10.0.0.5/x")).toBe(false);
    expect(isAllowedEndpoint("https://[::1]/x")).toBe(false);
  });

  it("логин/пароль в URL — нет", () => {
    expect(isAllowedEndpoint("https://user:pass@fcm.googleapis.com/x")).toBe(false);
  });

  it("хост без точки, мусор и не-строка — нет", () => {
    expect(isAllowedEndpoint("https://intranet/x")).toBe(false);
    expect(isAllowedEndpoint("not a url")).toBe(false);
    expect(isAllowedEndpoint(null)).toBe(false);
    expect(isAllowedEndpoint(12345)).toBe(false);
  });

  it("слишком длинный endpoint — нет (в стор такое не пишем)", () => {
    expect(isAllowedEndpoint(`https://fcm.googleapis.com/${"a".repeat(1100)}`)).toBe(false);
  });
});

describe("parseSubscription — ключи проверяются ДО записи в стор", () => {
  it("стандартная форма PushSubscription.toJSON() принимается", () => {
    const r = parseSubscription(subBody());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH });
  });

  it("плоская форма (для curl/e2e) тоже принимается", () => {
    const r = parseSubscription({ endpoint: ENDPOINT, p256dh: P256DH, auth: AUTH });
    expect(r.ok).toBe(true);
  });

  it("p256dh не 65 байт — bad_subscription", () => {
    const r = parseSubscription(subBody({ keys: { p256dh: "BBBB", auth: AUTH } }));
    expect(r).toEqual({ ok: false, error: "bad_subscription" });
  });

  it("auth не 16 байт — bad_subscription", () => {
    const r = parseSubscription(subBody({ keys: { p256dh: P256DH, auth: "AAAA" } }));
    expect(r).toEqual({ ok: false, error: "bad_subscription" });
  });

  it("не-base64url символы не проходят, даже если длина после декода совпала", () => {
    // Buffer.from(..., "base64url") молча игнорирует мусор — поэтому в реализации сначала
    // регэксп, и без него такая строка легла бы в базу как валидный ключ.
    const dirty = `${P256DH.slice(0, 40)}!!!!${P256DH.slice(44)}`;
    const r = parseSubscription(subBody({ keys: { p256dh: dirty, auth: AUTH } }));
    expect(r.ok).toBe(false);
  });

  it("ключ не в uncompressed-форме (первый байт не 0x04) — bad_subscription", () => {
    const compressedish = Buffer.concat([
      Buffer.from([0x02]),
      Buffer.from(P256DH, "base64url").subarray(1),
    ]).toString("base64url");
    const r = parseSubscription(subBody({ keys: { p256dh: compressedish, auth: AUTH } }));
    expect(r).toEqual({ ok: false, error: "bad_subscription" });
  });

  it("плохой endpoint отделён от плохих ключей отдельным кодом ошибки", () => {
    const r = parseSubscription(subBody({ endpoint: "https://127.0.0.1/x" }));
    expect(r).toEqual({ ok: false, error: "bad_endpoint" });
  });
});

describe("parseEndpointOnly / endpointFingerprint", () => {
  it("отписка принимает только годный endpoint", () => {
    expect(parseEndpointOnly({ endpoint: ENDPOINT })).toBe(ENDPOINT);
    expect(parseEndpointOnly({ endpoint: "https://localhost/x" })).toBe(null);
    expect(parseEndpointOnly({})).toBe(null);
  });

  it("отпечаток детерминирован, короткий и НЕ содержит самого endpoint'а", () => {
    const f = endpointFingerprint(ENDPOINT);
    expect(f).toMatch(/^[0-9a-f]{24}$/);
    expect(f).toBe(endpointFingerprint(ENDPOINT));
    expect(f).not.toContain("googleapis");
    expect(endpointFingerprint(`${ENDPOINT}x`)).not.toBe(f);
  });
});

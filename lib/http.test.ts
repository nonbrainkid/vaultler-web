import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readJsonBody, resolveIdentity, sameOriginOk } from "./http";
import { SESSION_COOKIE, signedCookieValue } from "./session";

const HOST = "vaultler.test";
const VICTIM = "wallet:0xabc0000000000000000000000000000000000001";

function req(
  init: {
    headers?: Record<string, string>;
    cookies?: Record<string, string>;
    body?: string;
    method?: string;
  } = {},
): NextRequest {
  const headers = new Headers({ host: HOST, ...(init.headers ?? {}) });
  const cookiePairs = Object.entries(init.cookies ?? {});
  if (cookiePairs.length > 0) {
    headers.set("cookie", cookiePairs.map(([k, v]) => `${k}=${v}`).join("; "));
  }
  return new NextRequest(`https://${HOST}/api/state`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers,
    body: init.body,
  });
}

afterEach(() => {
  delete process.env.AUTH_DOMAIN;
});

describe("resolveIdentity — заголовок с идентичностью не принимается на слово", () => {
  it("сырой (неподписанный) x-vaultler-id игнорируется", async () => {
    // Регрессия на главную находку аудита: роут доверял заголовку, а его защищала
    // только перезапись в proxy. Один `curl -H "x-vaultler-id: wallet:0x…"` в обход
    // proxy давал полный доступ к чужому аккаунту, включая кошельки из топа борда.
    const id = await resolveIdentity(req({ headers: { "x-vaultler-id": VICTIM } }));
    expect(id).not.toBe(VICTIM);
    expect(id.startsWith("dev:")).toBe(true);
  });

  it("подписанный заголовок принимается", async () => {
    const signed = await signedCookieValue(VICTIM);
    expect(await resolveIdentity(req({ headers: { "x-vaultler-id": signed } }))).toBe(
      VICTIM,
    );
  });

  it("подпись от другого id к заголовку не подходит", async () => {
    const signed = await signedCookieValue("dev:attacker");
    const mac = signed.slice(signed.lastIndexOf(".") + 1);
    const forged = `v1:${Date.now()}:${VICTIM}.${mac}`;
    const id = await resolveIdentity(req({ headers: { "x-vaultler-id": forged } }));
    expect(id).not.toBe(VICTIM);
  });

  it("без заголовка идентичность берётся из подписанной cookie", async () => {
    const signed = await signedCookieValue(VICTIM);
    expect(
      await resolveIdentity(req({ cookies: { [SESSION_COOKIE]: signed } })),
    ).toBe(VICTIM);
  });

  it("подделанная cookie не проходит", async () => {
    const id = await resolveIdentity(req({ cookies: { [SESSION_COOKIE]: VICTIM } }));
    expect(id).not.toBe(VICTIM);
  });
});

describe("sameOriginOk — второй слой против CSRF", () => {
  it("свой origin проходит", () => {
    expect(sameOriginOk(req({ headers: { origin: `https://${HOST}` } }))).toBe(true);
  });

  it("чужой origin отклоняется", () => {
    expect(sameOriginOk(req({ headers: { origin: "https://evil.example" } }))).toBe(false);
  });

  it("cross-site по sec-fetch-site отклоняется даже без origin", () => {
    expect(sameOriginOk(req({ headers: { "sec-fetch-site": "cross-site" } }))).toBe(false);
  });

  it("запрос без origin (curl, e2e-скрипты) проходит — cookie жертвы ему взять неоткуда", () => {
    expect(sameOriginOk(req())).toBe(true);
    expect(sameOriginOk(req({ headers: { "sec-fetch-site": "none" } }))).toBe(true);
  });

  it("в проде сверяемся с припиненным доменом, а не с подделываемым Host", () => {
    process.env.AUTH_DOMAIN = "vaultler.xyz";
    expect(sameOriginOk(req({ headers: { origin: `https://${HOST}` } }))).toBe(false);
    expect(sameOriginOk(req({ headers: { origin: "https://vaultler.xyz" } }))).toBe(true);
  });

  it("мусорный origin отклоняется", () => {
    expect(sameOriginOk(req({ headers: { origin: "not-a-url" } }))).toBe(false);
  });
});

describe("readJsonBody — потолок на размер тела", () => {
  it("обычный объект читается", async () => {
    const r = await readJsonBody(req({ body: JSON.stringify({ nickname: "dusty" }) }));
    expect(r).toEqual({ ok: true, value: { nickname: "dusty" } });
  });

  it("тело больше потолка отбрасывается, а не разбирается", async () => {
    const huge = JSON.stringify({ nickname: "x".repeat(20_000) });
    expect(await readJsonBody(req({ body: huge }))).toEqual({
      ok: false,
      error: "too_large",
    });
  });

  it("не-объект и битый JSON отклоняются", async () => {
    expect(await readJsonBody(req({ body: "[1,2,3]" }))).toEqual({
      ok: false,
      error: "bad_body",
    });
    expect(await readJsonBody(req({ body: "{oops" }))).toEqual({
      ok: false,
      error: "bad_body",
    });
  });
});

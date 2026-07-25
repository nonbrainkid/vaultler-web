import { describe, it, expect } from "vitest";
import {
  SESSION_TTL_MS,
  SESSION_VERSION,
  identityFromCookie,
  newIdentity,
  readSignedIdentity,
  signedCookieValue,
} from "./session";

const NOW = 1_700_000_000_000;
const WALLET = "wallet:0xabc0000000000000000000000000000000000001";

describe("подпись сессии", () => {
  it("своё значение принимается и возвращает тот же id", async () => {
    const raw = await signedCookieValue(WALLET, NOW);
    expect(await identityFromCookie(raw, NOW)).toBe(WALLET);
  });

  it("id с двоеточиями внутри переживает round-trip", async () => {
    // `wallet:0x…` сам содержит разделитель — склейка payload не должна его резать.
    const raw = await signedCookieValue(WALLET, NOW);
    expect((await readSignedIdentity(raw, NOW))?.id).toBe(WALLET);
    const dev = newIdentity();
    expect(await identityFromCookie(await signedCookieValue(dev, NOW), NOW)).toBe(dev);
  });

  it("подмена id ломает подпись — чужой аккаунт так не занять", async () => {
    const raw = await signedCookieValue("dev:me", NOW);
    const mac = raw.slice(raw.lastIndexOf(".") + 1);
    const forged = `${SESSION_VERSION}:${NOW}:${WALLET}.${mac}`;
    expect(await identityFromCookie(forged, NOW)).toBeNull();
  });

  it("значение без подписи не проходит", async () => {
    expect(await identityFromCookie(`${SESSION_VERSION}:${NOW}:${WALLET}`, NOW)).toBeNull();
    expect(await identityFromCookie(WALLET, NOW)).toBeNull();
    expect(await identityFromCookie(undefined, NOW)).toBeNull();
    expect(await identityFromCookie("", NOW)).toBeNull();
  });

  it("сессия протухает по TTL", async () => {
    const raw = await signedCookieValue(WALLET, NOW);
    expect(await identityFromCookie(raw, NOW + SESSION_TTL_MS - 1000)).toBe(WALLET);
    expect(await identityFromCookie(raw, NOW + SESSION_TTL_MS + 1000)).toBeNull();
  });

  it("cookie «из будущего» отвергается", async () => {
    // Иначе достаточно было бы выпустить себе вечную сессию на инстансе с уехавшими часами.
    const raw = await signedCookieValue(WALLET, NOW + 10 * 60_000);
    expect(await identityFromCookie(raw, NOW)).toBeNull();
  });

  it("чужая версия формата отвергается — рубильник «разлогинить всех» работает", async () => {
    const raw = await signedCookieValue(WALLET, NOW);
    const bumped = raw.replace(`${SESSION_VERSION}:`, "v0:");
    expect(await identityFromCookie(bumped, NOW)).toBeNull();
  });

  it("гигантское значение отбрасывается до крипто-операций", async () => {
    expect(await identityFromCookie("x".repeat(5000) + ".sig", NOW)).toBeNull();
  });

  it("продление сохраняет исходный возраст сессии", async () => {
    const raw = await signedCookieValue(WALLET, NOW);
    const info = await readSignedIdentity(raw, NOW + 1000);
    expect(info?.issuedAt).toBe(NOW);
  });
});

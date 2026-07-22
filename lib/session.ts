/**
 * Идентичность игрока на M1 — временная серверная сессия в подписанной cookie.
 *
 * Значение cookie = `<id>.<HMAC-SHA256(id, SECRET)>`. Клиент не знает SECRET,
 * поэтому не может выдать себя за чужой id (подпись не сойдётся). Это заглушка
 * до M2, где идентичностью станет адрес кошелька, подтверждённый подписью (SIWE-стиль).
 *
 * ВАЖНО: в проде обязателен стойкий SESSION_SECRET в env (см. NOTES.md).
 */
import crypto from "node:crypto";

export const SESSION_COOKIE = "vaultler_sid";
const SECRET = process.env.SESSION_SECRET ?? "dev-insecure-secret-change-me";

function sign(id: string): string {
  const mac = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  return `${id}.${mac}`;
}

function verify(value: string): string | null {
  const idx = value.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = value.slice(0, idx);
  const mac = value.slice(idx + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return id;
}

export function newIdentity(): string {
  return "dev:" + crypto.randomUUID();
}

export function signedCookieValue(id: string): string {
  return sign(id);
}

/** Вернуть валидную идентичность из сырого значения cookie, либо null. */
export function identityFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  return verify(raw);
}

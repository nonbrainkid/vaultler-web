/**
 * Идентичность игрока в подписанной cookie.
 *
 * Значение cookie = `<id>.<HMAC-SHA256(id, SECRET)>`. Клиент не знает SECRET,
 * поэтому не может выдать себя за чужой id (подпись не сойдётся).
 *
 * Тут живут анонимные сессии `dev:<uuid>` — играть можно без кошелька. После входа
 * подписью (SIWE) в ту же cookie кладётся `wallet:<addr>`; всё, что связано с ником
 * и наградами, требует именно её (docs/auth-session.md).
 *
 * Реализовано на Web Crypto (crypto.subtle), чтобы модуль работал и в Edge (proxy.ts),
 * и в Node (API-роуты) — единый источник правды.
 *
 * ВАЖНО: в проде обязателен стойкий SESSION_SECRET в env (docs/deployment.md).
 */

export const SESSION_COOKIE = "vaultler_sid";

/**
 * Дефолт допустим ТОЛЬКО локально. В проде он был бы публично известен из репозитория:
 * зная его, любой подделает подпись cookie и выдаст себя за чужого игрока — включая
 * кошельковые аккаунты на борде, который делит реальные токены. Поэтому падаем явно.
 *
 * Проверка ленивая (на момент использования, а не импорта): при `next build`
 * NODE_ENV=production, но рантайм-секрета там ещё нет — сборка не должна падать.
 */
function getSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "SESSION_SECRET не задан (или короче 16 символов) в production. " +
        "Сгенерируйте: openssl rand -base64 32",
    );
  }
  return "dev-insecure-secret-change-me";
}
const enc = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return base64url(new Uint8Array(sig));
}

/** Сравнение строк за константное время (защита от timing-атак на подпись). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function newIdentity(): string {
  return "dev:" + crypto.randomUUID();
}

export async function signedCookieValue(id: string): Promise<string> {
  return `${id}.${await hmac(id)}`;
}

/** Вернуть валидную идентичность из сырого значения cookie, либо null. */
export async function identityFromCookie(raw: string | undefined): Promise<string | null> {
  if (!raw) return null;
  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const id = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);
  const expected = await hmac(id);
  return safeEqual(mac, expected) ? id : null;
}

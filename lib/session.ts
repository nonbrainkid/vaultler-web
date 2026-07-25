/**
 * Идентичность игрока в подписанной cookie.
 *
 * Значение cookie = `<payload>.<HMAC-SHA256(payload, SECRET)>`, где
 * `payload = <версия>:<issuedAt мс>:<id>`. Клиент не знает SECRET, поэтому не может
 * выдать себя за чужой id (подпись не сойдётся).
 *
 * Тут живут анонимные сессии `dev:<uuid>` — играть можно без кошелька. После входа
 * подписью (SIWE) в ту же cookie кладётся `wallet:<addr>`; всё, что связано с ником
 * и наградами, требует именно её (docs/auth-session.md).
 *
 * Зачем версия и время выпуска в payload (а не голый id, как было раньше):
 *  - утёкшая cookie (общий компьютер, чужой браузер, логи прокси) действовала ГОД и
 *    не отзывалась ничем — logout чистит куку только у того, кто её и так держит;
 *  - при подозрении на компрометацию не было способа разом инвалидировать все сессии,
 *    кроме смены SESSION_SECRET (что ломает и честные);
 *  - теперь достаточно поднять SESSION_VERSION, а старые сессии протухают сами.
 *
 * Реализовано на Web Crypto (crypto.subtle), чтобы модуль работал и в Edge (proxy.ts),
 * и в Node (API-роуты) — единый источник правды.
 *
 * ВАЖНО: в проде обязателен стойкий SESSION_SECRET в env (docs/deployment.md).
 */

export const SESSION_COOKIE = "vaultler_sid";

/**
 * Версия формата сессии. Поднять — значит разлогинить всех разом (аварийный рубильник
 * при подозрении на утечку). Старые cookie перестают проходить проверку.
 */
export const SESSION_VERSION = "v1";

/** Сколько живёт сессия с момента выпуска. Дальше — требуется вход заново. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * С какого возраста cookie переподписывается на навигации (скользящее окно).
 * Активный игрок не разлогинивается на 30-й день, а брошенная сессия всё равно тухнет.
 */
export const SESSION_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/** Максимальный размер значения cookie — отсекаем мусор до крипто-операций. */
const MAX_COOKIE_LEN = 512;

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

/**
 * Подписанное значение для cookie (и для доверенного заголовка от proxy).
 * `issuedAt` передаётся явно, чтобы переподпись при продлении сохраняла исходный
 * возраст сессии, а не обнуляла TTL на каждом запросе.
 */
export async function signedCookieValue(
  id: string,
  issuedAt: number = Date.now(),
): Promise<string> {
  const payload = `${SESSION_VERSION}:${Math.trunc(issuedAt)}:${id}`;
  return `${payload}.${await hmac(payload)}`;
}

export interface SessionInfo {
  id: string;
  issuedAt: number;
}

/**
 * Разобрать и проверить подписанное значение сессии.
 * null — подпись не сошлась, формат чужой, версия устарела или срок истёк.
 */
export async function readSignedIdentity(
  raw: string | undefined | null,
  now: number = Date.now(),
): Promise<SessionInfo | null> {
  if (!raw || raw.length > MAX_COOKIE_LEN) return null;

  const idx = raw.lastIndexOf(".");
  if (idx <= 0) return null;
  const payload = raw.slice(0, idx);
  const mac = raw.slice(idx + 1);

  // Подпись сверяем ПЕРВОЙ: разбирать содержимое имеет смысл только после того,
  // как доказано, что payload наш и не менялся.
  const expected = await hmac(payload);
  if (!safeEqual(mac, expected)) return null;

  // `id` сам содержит ':' (`wallet:0x…`), поэтому склеиваем всё после второго разделителя.
  const parts = payload.split(":");
  if (parts.length < 3) return null;
  const [version, issuedRaw] = parts;
  if (version !== SESSION_VERSION) return null;

  const issuedAt = Number(issuedRaw);
  if (!Number.isFinite(issuedAt)) return null;
  // Срок вышел либо cookie выпущена «в будущем» (переведённые часы / подделка времени
  // на другом инстансе) — в обоих случаях доверять ей нельзя.
  if (now - issuedAt > SESSION_TTL_MS) return null;
  if (issuedAt - now > 60_000) return null;

  const id = parts.slice(2).join(":");
  if (!id) return null;
  return { id, issuedAt };
}

/** Вернуть валидную идентичность из сырого значения cookie, либо null. */
export async function identityFromCookie(
  raw: string | undefined | null,
  now: number = Date.now(),
): Promise<string | null> {
  return (await readSignedIdentity(raw, now))?.id ?? null;
}

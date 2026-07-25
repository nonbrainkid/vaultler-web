/**
 * Rate-limit эндпоинтов (анти-спам, анти-накрутка).
 *
 * Счётчики живут в общем Redis (Vercel KV / Upstash), когда он сконфигурирован. Без
 * общего стора лимит на Vercel обходится тривиально: запросы размазываются по инстансам,
 * у каждого своя память и свой пустой счётчик (подробнее — `lib/kv.ts`).
 *
 * Если стор не настроен или отвалился — откат на счётчики в памяти процесса. Это слабее,
 * но лучше, чем отсутствие барьера, и не роняет сайт из-за недоступного Redis
 * (лимитер — защита от флуда, а не от денежной операции: сам кранк валидируется фазой
 * в `lib/game.ts`, там обойти ничего нельзя).
 *
 * Окно фиксированное (номер окна в ключе), а не скользящее: `INCR`+`EXPIRE` атомарны и
 * укладываются в один round-trip. Плата — на стыке двух окон теоретически проходит до
 * 2× лимита. Для анти-флуда приемлемо; лимиты выставлены с этим запасом.
 */
import { getKv, kvConfig, type Kv } from "./kv";

/** Минимальный интервал между кранками одного игрока. */
const MIN_CRANK_INTERVAL_MS = 1000;

/** Вход кошельком. Подпись не брутфорсится (нужен приватник), лимит — анти-флуд. */
const AUTH_LIMIT = 30;
const NONCE_LIMIT = 40;
/** Смена ника/приватности — свой бюджет, чтобы не конкурировал с логином. */
const PROFILE_LIMIT = 30;
const WINDOW_MS = 60_000;

// ---- Фолбэк: счётчики в памяти процесса ----

function memoryInterval(minIntervalMs: number) {
  const last = new Map<string, number>();
  return (key: string, now: number): boolean => {
    const prev = last.get(key) ?? 0;
    if (now - prev < minIntervalMs) return false;
    last.set(key, now);
    // Не даём мапе пухнуть без границ на долгоживущем инстансе.
    if (last.size > 5000) {
      for (const [k, t] of last) if (now - t >= minIntervalMs) last.delete(k);
    }
    return true;
  };
}

/** Скользящее окно: не более `limit` событий по ключу за `windowMs`. */
function memoryWindow(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number): boolean => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return false;
    }
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return true;
  };
}

const memCrank = memoryInterval(MIN_CRANK_INTERVAL_MS);
const memAuth = memoryWindow(AUTH_LIMIT, WINDOW_MS);
const memNonce = memoryWindow(NONCE_LIMIT, WINDOW_MS);
const memProfile = memoryWindow(PROFILE_LIMIT, WINDOW_MS);

// ---- Общий стор ----

const PREFIX = "vltr:rl";

/** Фиксированное окно в Redis: номер окна в ключе, TTL = длина окна. */
async function kvWindow(
  kv: Kv,
  bucketKey: string,
  limit: number,
  windowMs: number,
  now: number,
): Promise<boolean> {
  const bucket = Math.floor(now / windowMs);
  const n = await kv.bumpCounter(`${bucketKey}:${bucket}`, Math.ceil(windowMs / 1000));
  return n <= limit;
}

/** Логи ошибок Redis — не чаще раза в минуту, иначе флуд забьёт логи Vercel. */
let lastWarnAt: number | null = null;
function warnKvDown(err: unknown, now: number): void {
  // null, а не 0: «ещё не предупреждали» — не то же самое, что «предупреждали в эпоху 0»,
  // иначе первое же предупреждение глохло бы при малом now.
  if (lastWarnAt !== null && now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[ratelimit] общий стор недоступен, откат в память процесса:", err);
}

/**
 * Спросить общий стор; при его отсутствии или ошибке — счётчик в памяти.
 * Единая точка отката, чтобы поведение всех лимитеров было одинаковым.
 */
async function guard(
  viaKv: (kv: Kv) => Promise<boolean>,
  viaMemory: (key: string, now: number) => boolean,
  key: string,
  now: number,
): Promise<boolean> {
  const kv = getKv();
  if (kv) {
    try {
      return await viaKv(kv);
    } catch (err) {
      warnKvDown(err, now);
    }
  }
  return viaMemory(key, now);
}

// ---- Публичный API ----

/** Не чаще одного кранка в секунду на игрока. */
export function allowCrank(identity: string, now: number): Promise<boolean> {
  return guard(
    (kv) =>
      kv.setIfAbsent(
        `${PREFIX}:crank:${identity}`,
        Math.ceil(MIN_CRANK_INTERVAL_MS / 1000),
      ),
    memCrank,
    identity,
    now,
  );
}

export function allowAuth(key: string, now: number): Promise<boolean> {
  return guard(
    (kv) => kvWindow(kv, `${PREFIX}:auth:${key}`, AUTH_LIMIT, WINDOW_MS, now),
    memAuth,
    key,
    now,
  );
}

export function allowNonce(key: string, now: number): Promise<boolean> {
  return guard(
    (kv) => kvWindow(kv, `${PREFIX}:nonce:${key}`, NONCE_LIMIT, WINDOW_MS, now),
    memNonce,
    key,
    now,
  );
}

export function allowProfile(key: string, now: number): Promise<boolean> {
  return guard(
    (kv) => kvWindow(kv, `${PREFIX}:profile:${key}`, PROFILE_LIMIT, WINDOW_MS, now),
    memProfile,
    key,
    now,
  );
}

/** Что показать в /api/health: лимиты общие на все инстансы или только на этот. */
export function rateLimitBackend(): "shared" | "memory" {
  return kvConfig() ? "shared" : "memory";
}

/** Ключ клиента для rate-limit: первый IP из X-Forwarded-For (Vercel) либо fallback. */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/** Только для тестов: внутренности фиксированного окна в Redis. */
export const __testing = { kvWindow, memoryWindow, memoryInterval };

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

/**
 * Минимальный интервал между перечитываниями буста одним игроком.
 * Каждый такой запрос — обращение к RPC от нашего имени: без интервала один вошедший
 * игрок прокачивает через нас неограниченный поток к провайдеру (счёт + риск блокировки
 * ключа, а с ним отваливается буст у всех). Баланс токена так часто не меняется.
 */
const MIN_BOOST_INTERVAL_MS = 10_000;

/** Вход кошельком. Подпись не брутфорсится (нужен приватник), лимит — анти-флуд. */
const AUTH_LIMIT = 30;
const NONCE_LIMIT = 40;
/** Смена ника/приватности — свой бюджет, чтобы не конкурировал с логином. */
const PROFILE_LIMIT = 30;
const WINDOW_MS = 60_000;

/**
 * Выдача кода привязки Telegram — узкий бюджет per identity. Каждая выдача гасит
 * предыдущий код и пишет в KV дважды (lib/telegram-link.ts); без лимита страница-жертва
 * могла бы CSRF-вызовом накрутить лишние записи, а честный игрок случайным
 * даблклик-спамом — сжечь собственные ещё живые коды один за другим.
 */
const TELEGRAM_LINK_LIMIT = 5;
const TELEGRAM_LINK_WINDOW_MS = 10 * 60_000;

/**
 * Апдейты вебхука — лимит per chat.id. Основная защита от чужих запросов — секрет
 * вебхука (lib/telegram.ts); это скорее анти-флуд на случай, если один чат начнёт
 * заваливать нас командами (в т.ч. чужой скрипт, узнавший chat.id).
 */
const TELEGRAM_WEBHOOK_LIMIT = 20;
const TELEGRAM_WEBHOOK_WINDOW_MS = 60_000;

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
const memBoost = memoryInterval(MIN_BOOST_INTERVAL_MS);
const memAuth = memoryWindow(AUTH_LIMIT, WINDOW_MS);
const memNonce = memoryWindow(NONCE_LIMIT, WINDOW_MS);
const memProfile = memoryWindow(PROFILE_LIMIT, WINDOW_MS);
const memTelegramLink = memoryWindow(TELEGRAM_LINK_LIMIT, TELEGRAM_LINK_WINDOW_MS);
const memTelegramWebhook = memoryWindow(TELEGRAM_WEBHOOK_LIMIT, TELEGRAM_WEBHOOK_WINDOW_MS);

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

/** Не чаще одного перечитывания буста в 10 секунд на игрока (защита нашего RPC). */
export function allowBoost(identity: string, now: number): Promise<boolean> {
  return guard(
    (kv) =>
      kv.setIfAbsent(
        `${PREFIX}:boost:${identity}`,
        Math.ceil(MIN_BOOST_INTERVAL_MS / 1000),
      ),
    memBoost,
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

/** Выдача/перевыпуск кода привязки Telegram — 5 раз за 10 минут на identity. */
export function allowTelegramLink(key: string, now: number): Promise<boolean> {
  return guard(
    (kv) =>
      kvWindow(kv, `${PREFIX}:tglink:${key}`, TELEGRAM_LINK_LIMIT, TELEGRAM_LINK_WINDOW_MS, now),
    memTelegramLink,
    key,
    now,
  );
}

/** Апдейты вебхука Telegram — 20/мин на chat.id. */
export function allowTelegramWebhook(key: string, now: number): Promise<boolean> {
  return guard(
    (kv) =>
      kvWindow(
        kv,
        `${PREFIX}:tgwh:${key}`,
        TELEGRAM_WEBHOOK_LIMIT,
        TELEGRAM_WEBHOOK_WINDOW_MS,
        now,
      ),
    memTelegramWebhook,
    key,
    now,
  );
}

/** Что показать в /api/health: лимиты общие на все инстансы или только на этот. */
export function rateLimitBackend(): "shared" | "memory" {
  return kvConfig() ? "shared" : "memory";
}

/**
 * Что показать в /api/health: есть ли под IP-лимитами доверенный источник.
 * "session" означает, что IP считать неоткуда и лимит держится на cookie — на проде
 * это сигнал, что перед приложением нет ожидаемого прокси.
 */
export function clientIpSource(req: Request): "trusted" | "session" {
  return trustedIp(req) ? "trusted" : "session";
}

/**
 * Разрешить доверять `X-Forwarded-For` — только для самохостинга за обратным прокси,
 * который ПЕРЕЗАПИСЫВАЕТ (или дописывает справа) этот заголовок. На Vercel не нужно.
 */
const TRUST_XFF = process.env.TRUST_PROXY_XFF === "1";

/**
 * IP клиента из ДОВЕРЕННОГО источника; null — доверять нечему.
 *
 * Раньше ключом служил первый элемент `X-Forwarded-For`. Это чисто клиентское значение:
 * его присылает сам запрос, и достаточно менять его в каждом запросе, чтобы каждый
 * попадал в свой пустой счётчик. Лимитера фактически не существовало — проверено
 * локально: 45 запросов при лимите 40/мин прошли все до одного.
 *
 * Поэтому доверяем только тому, что проставляет инфраструктура и что клиентский
 * одноимённый заголовок гарантированно затирает:
 *  1) `x-vercel-forwarded-for` — ставит платформа;
 *  2) `x-real-ip` — платформа или nginx;
 *  3) `x-forwarded-for` — ТОЛЬКО при явном TRUST_PROXY_XFF=1, и берётся последний
 *     элемент: слева атакующий дописывает что угодно, справа значение подставляет
 *     ближайший к нам доверенный прокси.
 *
 * Если ничего этого нет (локальная разработка, голый порт наружу) — возвращаем null.
 * Это честнее, чем принять подделываемое значение и считать барьер работающим.
 */
export function trustedIp(req: Request): string | null {
  const vercel = req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim();
  if (vercel) return vercel;

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  if (TRUST_XFF) {
    const hops =
      req.headers
        .get("x-forwarded-for")
        ?.split(",")
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return null;
}

/**
 * Ключ клиента для rate-limit.
 *
 * Когда доверенного IP нет, ключуем по сессии, а не по общему ведру «unknown»:
 * общее ведро означало бы, что один флудер выбирает лимит за всех сразу (отказ в
 * обслуживании честным игрокам). Сессию атакующий, конечно, тоже может ротировать —
 * но за IP-барьер на serverless в любом случае отвечает инфраструктура, а не мы.
 */
export function clientKey(req: Request, identity?: string): string {
  const ip = trustedIp(req);
  if (ip) return `ip:${ip}`;
  return identity ? `sid:${identity}` : "unknown";
}

/** Только для тестов: внутренности фиксированного окна в Redis. */
export const __testing = { kvWindow, memoryWindow, memoryInterval };

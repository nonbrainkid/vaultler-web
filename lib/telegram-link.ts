/**
 * Одноразовый код привязки identity ↔ chatId Telegram.
 *
 * Схема (docs/brief-engineer.md → 1.1): сайт выдаёт код владельцу активной сессии →
 * игрок открывает `https://t.me/<bot>?start=<code>` → бот получает chat.id и код →
 * сервер связывает identity ↔ chatId. Единственная точка, где код вообще существует
 * "в открытом виде", — ответ `POST /api/telegram/link` тому, кто его запросил; дальше
 * он живёт только как SHA-256-хеш.
 *
 * ХРАНЕНИЕ: код (точнее его хеш) кладём в общий Redis (`lib/kv.ts`), а не в Postgres —
 * TTL там нативный (EX), и десятиминутная запись не должна становиться строкой в
 * основной БД, которую потом надо чистить отдельно. Если KV не настроен (только
 * локальная разработка — в проде он уже подключён, docs/deployment.md), падаем на
 * карту в памяти процесса: слабее (не переживает несколько serverless-инстансов), но
 * не роняет фичу целиком — тот же компромисс, что и в `lib/ratelimit.ts`.
 *
 * ОДНОРАЗОВОСТЬ: код читается через `GETDEL` (атомарно на уровне Redis) — второй запрос
 * с тем же кодом гарантированно получит промах, а не гонку между GET и DEL в нашем коде.
 *
 * СРАВНЕНИЕ БЕЗ ТАЙМИНГ-АТАКИ: код не сравнивается напрямую — он используется как КЛЮЧ
 * поиска в KV (после SHA-256). Угадать ключ по времени ответа нельзя тем же способом,
 * каким угадывается байт за байтом в прямом строковом сравнении: неверный ключ просто не
 * находит записи, а 128 бит энтропии делают перебор недостижимым в принципе.
 */
import { randomBytes, createHash } from "node:crypto";
import { getKv } from "./kv";
import type { Store } from "./store";

const PREFIX = "vltr:tglink";
/** 128 бит — то же требование, что и к SESSION_SECRET по порядку величины энтропии. */
const CODE_BYTES = 16;
/** TTL кода: 10 минут (docs/brief-engineer.md). */
const CODE_TTL_SEC = 600;

function codeKey(hash: string): string {
  return `${PREFIX}:code:${hash}`;
}
/** Обратный указатель "какой хеш сейчас активен у этого identity" — для инвалидации при перевыпуске. */
function issuedKey(identity: string): string {
  return `${PREFIX}:issued:${identity}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

// ---- Фолбэк: карта в памяти процесса (только для dev без настроенного KV) ----
interface MemEntry {
  value: string;
  expiresAt: number;
}
const mem = new Map<string, MemEntry>();

function memSet(key: string, value: string, ttlSec: number, now: number): void {
  mem.set(key, { value, expiresAt: now + ttlSec * 1000 });
  if (mem.size > 2000) {
    for (const [k, e] of mem) if (e.expiresAt <= now) mem.delete(k);
  }
}
function memGetDel(key: string, now: number): string | null {
  const e = mem.get(key);
  if (!e) return null;
  mem.delete(key);
  return e.expiresAt > now ? e.value : null; // протухшую запись не возвращаем
}

let lastWarnAt: number | null = null;
function warnKvDown(err: unknown, now: number): void {
  if (lastWarnAt !== null && now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[telegram-link] общий стор недоступен, откат в память процесса:", err);
}

async function putValue(key: string, value: string, now: number): Promise<void> {
  const kv = getKv();
  if (kv) {
    try {
      await kv.setValue(key, value, CODE_TTL_SEC);
      return;
    } catch (err) {
      warnKvDown(err, now);
    }
  }
  memSet(key, value, CODE_TTL_SEC, now);
}

async function takeValue(key: string, now: number): Promise<string | null> {
  const kv = getKv();
  if (kv) {
    try {
      return await kv.getAndDelete(key);
    } catch (err) {
      warnKvDown(err, now);
    }
  }
  return memGetDel(key, now);
}

export interface IssuedCode {
  code: string;
  expiresInSec: number;
}

/**
 * Выдать новый код для identity. Инвалидирует предыдущий код этого же identity, если он
 * ещё не истёк, — "новый код инвалидирует предыдущий" из задания: иначе у игрока, который
 * несколько раз нажал "получить код", было бы сразу два рабочих кода на один аккаунт.
 */
export async function issueLinkCode(identity: string, now: number): Promise<IssuedCode> {
  const oldHash = await takeValue(issuedKey(identity), now);
  if (oldHash) {
    // Старый код мог быть скопирован (буфер обмена, скриншот) — гасим его данные, а не
    // только обратный указатель.
    await takeValue(codeKey(oldHash), now);
  }

  const code = randomBytes(CODE_BYTES).toString("hex");
  const hash = hashCode(code);
  await putValue(codeKey(hash), identity, now);
  await putValue(issuedKey(identity), hash, now);

  return { code, expiresInSec: CODE_TTL_SEC };
}

/**
 * Проверить и ПОГАСИТЬ код (одноразовость). `null` — код неверный, протух или уже
 * использован ранее.
 */
export async function consumeLinkCode(code: string, now: number): Promise<string | null> {
  if (typeof code !== "string" || code.length === 0 || code.length > 64) return null;
  const identity = await takeValue(codeKey(hashCode(code)), now);
  if (identity) {
    // Лучшая попытка подчистить обратный указатель; не критично, если он уже протух сам.
    await takeValue(issuedKey(identity), now);
  }
  return identity;
}

export interface LinkOutcome {
  ok: boolean;
  error?: "invalid_code";
  /**
   * Chat, который был привязан к этому identity ДО этой привязки, если он отличается от
   * нового. Роут обязан уведомить его: "привязка перенесена" — иначе человек продолжал бы
   * ждать напоминания в мёртвый чат и не понимал бы, почему они не приходят.
   */
  displacedChatId: number | null;
}

/**
 * Погасить код и связать identity ↔ chatId в сторе. Тонкая обёртка вокруг
 * `consumeLinkCode` + `store.linkTelegram`, вынесенная из роута, чтобы её можно было
 * юнит-тестировать с мок-стором без поднятия HTTP.
 */
export async function completeLink(
  store: Store,
  chatId: number,
  code: string,
  now: number,
): Promise<LinkOutcome> {
  const identity = await consumeLinkCode(code, now);
  if (!identity) return { ok: false, error: "invalid_code", displacedChatId: null };
  const { displacedChatId } = await store.linkTelegram(identity, chatId, now);
  return { ok: true, displacedChatId };
}

/** Только для тестов: сбросить карту в памяти между кейсами. */
export function resetTelegramLinkMemoryForTests(): void {
  mem.clear();
  lastWarnAt = null;
}

/**
 * Форма ответа `GET /api/telegram/link`: НАМЕРЕННО принимает `chatId` только чтобы
 * посчитать boolean и тут же его отбрасывает. chatId — персональные данные (столько же,
 * сколько внутренний identity, docs/brief-engineer.md → приватность) и не должен уходить
 * ни в один ответ API ни при каких условиях. Вынесено в чистую функцию, а не оставлено
 * инлайном в роуте, специально: так у требования "chatId нигде не отдаётся" есть
 * юнит-тест (lib/telegram-link.test.ts), а не только код-ревью.
 */
export function toLinkStatusView(chatId: number | null): { linked: boolean } {
  return { linked: chatId !== null };
}

/**
 * Логика напоминаний: какие сообщения нужно отправить прямо сейчас и как это сделать,
 * не заспамив и не тронув игровой стейт.
 *
 * Момент напоминания считается ИСКЛЮЧИТЕЛЬНО из серверного стейта (`lastCrankAt` + тайминги
 * `lib/game.ts`), а не из какой-либо клиентской или отдельной "напоминательной" арифметики —
 * тот же принцип "сервер источник правды", что и во всей игре (CLAUDE.md, инвариант 1).
 *
 * ВАЖНО: бот НЕ мутирует игровой стейт. `dueReminders` получает уже посчитанные состояния
 * (вызывающий код применяет `settle()` В ПАМЯТИ, точно как это делает GET /api/state и
 * buildLeaderboard) и только решает, кому что написать — ни одного вызова `store.mutate`
 * здесь нет и быть не должно.
 */
import { GAME, type PlayerState } from "./game";
import { getKv } from "./kv";
import { DEFAULT_WARN_BEFORE_MS, dueKinds, type ReminderKind } from "./reminders";

export type { ReminderKind };

export interface DueReminder {
  identity: string;
  chatId: number;
  kind: ReminderKind;
  /** Часть ключа идемпотентности — см. `reserveReminder`. */
  lastCrankAt: number;
}

/**
 * Какие напоминания нужно отправить сейчас, из уже расчитанных (settled) состояний игроков.
 *
 * Само расписание («в какой фазе что уместно») живёт в `lib/reminders.ts` и общее с
 * веб-пушами: два канала обязаны срабатывать на одни и те же события, иначе игрок получал
 * бы предупреждение в браузере и не получал в Telegram. Здесь остаётся только привязка к
 * чату бота.
 *
 * Чистая функция: не читает `Date.now()`, не трогает сеть/БД — легко тестируется без моков.
 */
export function dueReminders(
  players: readonly { identity: string; state: PlayerState }[],
  chatIdByIdentity: ReadonlyMap<string, number>,
  now: number,
  warnBeforeMs: number = DEFAULT_WARN_BEFORE_MS,
): DueReminder[] {
  const out: DueReminder[] = [];
  for (const p of players) {
    const chatId = chatIdByIdentity.get(p.identity);
    if (chatId === undefined) continue; // не привязан к боту — писать некуда

    for (const kind of dueKinds(p.state, now, warnBeforeMs)) {
      // lastCrankAt здесь заведомо не null: dueKinds вернул непустой список только для
      // заведённой машины.
      out.push({ identity: p.identity, chatId, kind, lastCrankAt: p.state.lastCrankAt! });
    }
  }
  return out;
}

// ---- Идемпотентность рассылки: (identity, lastCrankAt, kind) ----
//
// Ключ включает lastCrankAt: он меняется на каждом новом заводе машины, поэтому у нового
// цикла всегда свежий ключ и напоминания приходят снова, а повторный тик крона внутри ОДНОГО
// цикла — нет. TTL берём из тайминга самой петли (WIND+GRACE) с запасом: запись должна
// пережить весь цикл, но не должна разрастаться бессрочно.

const PREFIX = "vltr:tgremind";
const DEDUP_TTL_SEC = Math.ceil((GAME.WIND_MS + GAME.GRACE_MS) / 1000) + 3600;

// Фолбэк в память процесса — тот же компромисс, что и в lib/ratelimit.ts и
// lib/telegram-link.ts: без общего KV перезапуск/масштабирование инстансов может повторно
// прислать напоминание, но сайт не падает и хотя бы в один инстанс дедуп работает.
const seen = new Map<string, number>();
function memSetIfAbsent(key: string, ttlSec: number, now: number): boolean {
  const exp = seen.get(key);
  if (exp !== undefined && exp > now) return false;
  seen.set(key, now + ttlSec * 1000);
  if (seen.size > 5000) {
    for (const [k, e] of seen) if (e <= now) seen.delete(k);
  }
  return true;
}

let lastWarnAt: number | null = null;
function warnKvDown(err: unknown, now: number): void {
  if (lastWarnAt !== null && now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn("[telegram-remind] общий стор недоступен, откат в память процесса:", err);
}

/** Зарезервировать право отправить именно ЭТО напоминание. false — уже отправлено. */
export async function reserveReminder(r: DueReminder, now: number): Promise<boolean> {
  const key = `${PREFIX}:${r.identity}:${r.lastCrankAt}:${r.kind}`;
  const kv = getKv();
  if (kv) {
    try {
      return await kv.setIfAbsent(key, DEDUP_TTL_SEC);
    } catch (err) {
      warnKvDown(err, now);
    }
  }
  return memSetIfAbsent(key, DEDUP_TTL_SEC, now);
}

// ---- Прогон рассылки (IO вынесено в зависимости — тестируется без сети) ----

export interface ReminderDeps {
  send: (chatId: number, kind: ReminderKind) => Promise<{ ok: boolean; blocked: boolean }>;
  /** Вызывается, если Telegram ответил 403 (bot was blocked by the user). */
  unlink: (chatId: number) => Promise<void>;
  reserve: (r: DueReminder, now: number) => Promise<boolean>;
}

export interface RunSummary {
  sent: number;
  skippedDuplicate: number;
  /** Отправка не удалась из-за блокировки бота — привязка удалена автоматически. */
  unlinkedBlocked: number;
  /** Отправка не удалась по другой причине (сеть, 429 и т.п.) — просто пропущено. */
  failed: number;
}

/**
 * Прогнать список due-напоминаний: резервируем слот идемпотентности, отправляем, на 403
 * удаляем привязку. Логика вынесена из роута и принимает зависимости параметрами —
 * юнит-тест подставляет моки `send`/`unlink`/`reserve` и не трогает ни сеть, ни KV, ни стор.
 */
export async function runReminders(
  due: readonly DueReminder[],
  now: number,
  deps: ReminderDeps,
): Promise<RunSummary> {
  const summary: RunSummary = { sent: 0, skippedDuplicate: 0, unlinkedBlocked: 0, failed: 0 };

  for (const r of due) {
    // Слот бронируем ДО отправки: конкурентный/повторный прогон крона не должен послать
    // одно и то же напоминание дважды. Плата — если отправка потом всё же не удастся,
    // напоминание для этого цикла считается "сгоревшим" (не будет второй попытки), но это
    // осознанно дешевле, чем риск задвоить сообщение — именно это прямо запрещено заданием.
    if (!(await deps.reserve(r, now))) {
      summary.skippedDuplicate++;
      continue;
    }
    const res = await deps.send(r.chatId, r.kind);
    if (res.ok) {
      summary.sent++;
    } else if (res.blocked) {
      // "Bot was blocked by the user" — удаляем привязку сами, иначе будем долбиться
      // в заблокировавшего игрока на каждом следующем тике крона до конца времён.
      await deps.unlink(r.chatId);
      summary.unlinkedBlocked++;
    } else {
      summary.failed++;
    }
  }
  return summary;
}

/** Только для тестов: сбросить карту дедупа в памяти между кейсами. */
export function resetTelegramRemindMemoryForTests(): void {
  seen.clear();
  lastWarnAt = null;
}

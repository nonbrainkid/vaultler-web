/**
 * Общее расписание напоминаний — ОДИН ответ на вопрос «когда игроку пора написать».
 *
 * Зачем отдельный модуль: каналов напоминаний стало два (Telegram-бот и веб-пуши), и если
 * бы каждый считал момент сам, они бы разошлись — игрок получал бы предупреждение о рейдере
 * в браузере и не получал в Telegram (или наоборот), а причину такого расхождения пришлось
 * бы искать в двух реализациях одной формулы. Момент считается ИСКЛЮЧИТЕЛЬНО из серверного
 * стейта (`lastCrankAt` + тайминги `lib/game.ts`) — тот же инвариант «сервер источник
 * правды», что и во всей игре (CLAUDE.md, инвариант 1).
 *
 * Модуль чистый: не читает `Date.now()`, env, сеть и БД.
 */
import { GAME, phase, type PlayerState } from "./game";

export type ReminderKind = "window_open" | "raid_warning";

/** За сколько до рейдера слать предупреждение (docs/brief-engineer.md: «2 часа»). */
export const DEFAULT_WARN_BEFORE_MS = 2 * 60 * 60 * 1000;

/**
 * Какие напоминания актуальны для этого игрока прямо сейчас.
 *
 * Оба имеют смысл ТОЛЬКО в фазе `ready` — окно открыто и рейда ещё не было:
 *  - `window_open` актуален всё время, пока фаза `ready` (одноразовость обеспечивает не
 *    эта функция, а дедуп канала по `lastCrankAt` — крон видит `ready` на многих тиках);
 *  - `raid_warning` — только в последние `warnBeforeMs` миллисекунд перед рейдом.
 *
 * Порядок не случаен: `window_open` первым, чтобы при обоих событиях разом игрок получил
 * сначала «окно открылось», а не пугающее «2 часа осталось» без контекста.
 */
export function dueKinds(
  state: PlayerState,
  now: number,
  warnBeforeMs: number = DEFAULT_WARN_BEFORE_MS,
): ReminderKind[] {
  if (!state.machineOn || state.lastCrankAt === null) return [];
  if (phase(state, now) !== "ready") return []; // ещё заводится, либо уже рейд/выключена

  const kinds: ReminderKind[] = ["window_open"];
  const raidAt = state.lastCrankAt + GAME.WIND_MS + GAME.GRACE_MS;
  if (raidAt - now <= warnBeforeMs) kinds.push("raid_warning");
  return kinds;
}

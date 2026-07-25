/**
 * Лидерборд и «общий сейф» — считаются на сервере из снапшота всех игроков.
 * Каждому игроку применяем settle на текущий момент, чтобы цифры были честные
 * (у зарейженных/накапавших — актуальные), а не устаревший stored-stack.
 *
 * Приватность: наружу отдаём ярлык (ник / короткий адрес / «anon») и — если игрок НЕ
 * скрыл кошелёк — полный адрес для ссылки на explorer. Скрыл → адрес не уходит вообще.
 * Сырые внутренние id (dev:uuid) наружу никогда не отдаём.
 */
import { settle, type PlayerState } from "./game";
import { addressFromIdentity } from "./auth";
import type { PlayerSnapshot } from "./store";

/**
 * Недельный цикл пула: граница — **суббота 00:00 по Нью-Йорку**.
 *
 * Почему нельзя обойтись якорем в UTC и остатком от деления (как было раньше):
 * Нью-Йорк живёт с переходом на летнее время. Фиксированная сетка «каждые 7×24 часа от
 * якоря» дважды в год уезжает на час — сброс начинал бы приходиться на 23:00 пятницы или
 * 01:00 субботы. Игроки видят обратный отсчёт до раздачи призов, и «час туда-час обратно»
 * здесь означает, что кто-то не успел крутануть. Поэтому границу считаем календарно, в
 * самой зоне.
 *
 * Приятное свойство именно субботней полуночи: переходы DST в США происходят в
 * ВОСКРЕСЕНЬЕ в 02:00, поэтому «суббота 00:00» существует всегда и ровно один раз —
 * нет ни несуществующего, ни задвоенного локального времени, которое пришлось бы
 * разруливать отдельно.
 */
const WEEK_ZONE = "America/New_York";
/** День недели сброса: 0 — воскресенье … 6 — суббота. */
const RESET_WEEKDAY = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ZONE_FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: WEEK_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  // h23, а не hour12:false: часть версий ICU при hour12:false отдаёт «24» для полуночи.
  hourCycle: "h23",
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 — воскресенье … 6 — суббота. */
  weekday: number;
}

/** Разложить момент времени на календарные части в зоне борда. */
function zonedParts(ts: number): ZonedParts {
  const p: Record<string, string> = {};
  for (const part of ZONE_FORMAT.formatToParts(new Date(ts))) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: Math.max(0, WEEKDAYS.indexOf(p.weekday)),
  };
}

/** Смещение зоны относительно UTC в конкретный момент (мс). Летом и зимой разное. */
function zoneOffsetMs(ts: number): number {
  const p = zonedParts(ts);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - ts;
}

/**
 * UTC-момент локальной полуночи указанной календарной даты.
 * Смещение зависит от искомого момента, поэтому берём его дважды: первая прикидка может
 * попасть по «летнему» смещению, вторая уже уточняет по фактическому.
 */
function localMidnightUtc(year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day);
  let ts = wall - zoneOffsetMs(wall);
  ts = wall - zoneOffsetMs(ts);
  return ts;
}

export interface WeekInfo {
  weekId: number;
  /** Сколько миллисекунд осталось до сброса. */
  endsInMs: number;
  /** Абсолютный момент сброса (epoch ms) — чтобы UI мог показать точную дату. */
  endsAt: number;
}

export function weekInfo(now: number): WeekInfo {
  const p = zonedParts(now);
  // Сколько дней назад была последняя суббота (0 — сегодня и есть суббота).
  const back = (p.weekday - RESET_WEEKDAY + 7) % 7;

  // Календарная арифметика в «UTC-меченых» датах: здесь нет ни зон, ни переходов —
  // просто вычитаем сутки из даты, а в реальный момент переводим уже через localMidnightUtc.
  const startDate = new Date(Date.UTC(p.year, p.month - 1, p.day) - back * DAY_MS);
  const endDate = new Date(startDate.getTime() + 7 * DAY_MS);

  const endsAt = localMidnightUtc(
    endDate.getUTCFullYear(),
    endDate.getUTCMonth() + 1,
    endDate.getUTCDate(),
  );

  return {
    // Номер недели считаем по КАЛЕНДАРНОЙ дате её начала, а не делением интервала на 7
    // суток: из-за перехода на летнее время неделя бывает 167 или 169 часов, и деление
    // однажды дало бы сдвиг номера на единицу.
    weekId: Math.floor(startDate.getTime() / DAY_MS / 7),
    endsInMs: endsAt - now,
    endsAt,
  };
}

/** Только для тестов и отладки: смещение зоны борда в конкретный момент. */
export const __weekTesting = { zonedParts, zoneOffsetMs, localMidnightUtc, WEEK_ZONE };

export interface LeaderRow {
  rank: number;
  label: string;
  kind: "wallet" | "anon" | "bot";
  /** Полный адрес для ссылки на explorer — только если игрок НЕ скрыл кошелёк. */
  address: string | null;
  stack: number;
  streak: number;
  isYou: boolean;
}

export interface LeaderboardView {
  communalVault: number; // сумма живых стеков всего комьюнити
  players: number;
  top: LeaderRow[];
  you: { rank: number; stack: number } | null;
  week: WeekInfo;
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

interface Display {
  label: string;
  kind: "wallet" | "anon" | "bot";
  address: string | null;
}

function displayFor(identity: string, state: PlayerState): Display {
  // Засеянные для тестов боты помечаются явно (борд делит реальные токены).
  if (identity.startsWith("bot:")) {
    return { label: identity.slice("bot:".length), kind: "bot", address: null };
  }

  const nick = state.nickname?.trim() || null;
  const addr = addressFromIdentity(identity);

  if (addr) {
    if (state.hideWallet) {
      // Скрыто: ник или «anon», адрес наружу НЕ уходит.
      return { label: nick || "anon", kind: "wallet", address: null };
    }
    // Открыто: ник (или короткий адрес) + полный адрес для explorer-ссылки.
    return { label: nick || shortAddr(addr), kind: "wallet", address: addr };
  }

  // Анонимная dev-сессия — ника быть не должно (API его не даёт), адреса нет.
  return { label: nick || "anon", kind: "anon", address: null };
}

export function buildLeaderboard(
  snapshot: PlayerSnapshot[],
  now: number,
  meIdentity: string,
  limit = 10,
): LeaderboardView {
  // живой стек каждого через settle (ник/приватность берём из стейта)
  const live = snapshot.map((p) => {
    const state: PlayerState = settle(p.state, now).state;
    return {
      identity: p.identity,
      stack: state.stack,
      streak: state.streak,
      display: displayFor(p.identity, state),
    };
  });

  live.sort((a, b) => b.stack - a.stack);

  const communalVault = live.reduce((sum, p) => sum + p.stack, 0);

  const top: LeaderRow[] = live.slice(0, limit).map((p, i) => ({
    rank: i + 1,
    label: p.display.label,
    kind: p.display.kind,
    address: p.display.address,
    stack: p.stack,
    streak: p.streak,
    isYou: p.identity === meIdentity,
  }));

  const myIndex = live.findIndex((p) => p.identity === meIdentity);
  const you =
    myIndex >= 0 ? { rank: myIndex + 1, stack: live[myIndex].stack } : null;

  return {
    communalVault,
    players: live.length,
    top,
    you,
    week: weekInfo(now),
  };
}

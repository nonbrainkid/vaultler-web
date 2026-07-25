/**
 * Недельный цикл борда: граница — **суббота 00:00 по Нью-Йорку**.
 *
 * Вынесено отдельным модулем без зависимостей, потому что границу недели теперь знают
 * оба слоя: и ядро петли (`lib/game.ts` фиксирует базу стека на начало недели), и борд
 * (`lib/leaderboard.ts` ранжирует по приросту). Если бы функция осталась в борде,
 * получился бы цикл импортов.
 *
 * Почему нельзя обойтись якорем в UTC и остатком от деления:
 * Нью-Йорк живёт с переходом на летнее время. Фиксированная сетка «каждые 7×24 часа от
 * якоря» дважды в год уезжает на час — сброс начинал бы приходиться на 23:00 пятницы или
 * 01:00 субботы. Игроки видят обратный отсчёт до раздачи призов, и этот час означает
 * чей-то не сделанный вовремя кранк. Поэтому границу считаем календарно, в самой зоне.
 *
 * Приятное свойство именно субботней полуночи: переходы DST в США происходят в
 * ВОСКРЕСЕНЬЕ в 02:00, поэтому «суббота 00:00» существует всегда и ровно один раз —
 * нет ни несуществующего, ни задвоенного локального времени.
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
  /** Момент начала недели (epoch ms) — от него считается прирост игрока. */
  startsAt: number;
  /** Абсолютный момент сброса (epoch ms) — чтобы UI мог показать точную дату. */
  endsAt: number;
  /** Сколько миллисекунд осталось до сброса. */
  endsInMs: number;
}

/**
 * Кэш последней посчитанной недели. `settle` вызывается для каждого игрока на каждом
 * чтении борда, а разбор даты через Intl — не самая дешёвая операция. Границы недели
 * меняются раз в семь суток, поэтому одного значения на процесс достаточно.
 */
let cached: WeekInfo | null = null;

export function weekInfo(now: number): WeekInfo {
  const c = cached;
  if (c && now >= c.startsAt && now < c.endsAt) {
    // endsInMs зависит от `now`, остальное — нет.
    return { ...c, endsInMs: c.endsAt - now };
  }
  const fresh = computeWeek(now);
  cached = fresh;
  return fresh;
}

function computeWeek(now: number): WeekInfo {
  const p = zonedParts(now);
  // Сколько дней назад была последняя суббота (0 — сегодня и есть суббота).
  const back = (p.weekday - RESET_WEEKDAY + 7) % 7;

  // Календарная арифметика в «UTC-меченых» датах: здесь нет ни зон, ни переходов —
  // просто вычитаем сутки из даты, а в реальный момент переводим уже через localMidnightUtc.
  const startDate = new Date(Date.UTC(p.year, p.month - 1, p.day) - back * DAY_MS);
  const endDate = new Date(startDate.getTime() + 7 * DAY_MS);

  const startsAt = localMidnightUtc(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth() + 1,
    startDate.getUTCDate(),
  );
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
    startsAt,
    endsAt,
    endsInMs: endsAt - now,
  };
}

/** Только для тестов и отладки. */
export const __weekTesting = { zonedParts, zoneOffsetMs, localMidnightUtc, WEEK_ZONE };

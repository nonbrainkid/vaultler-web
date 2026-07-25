/**
 * VAULTLER — ядро игровой механики (server-authoritative).
 *
 * Чистые функции: НЕ читают время из окружения, НЕ трогают БД.
 * Вызывающий код передаёт `now` (серверный Date.now()) и текущий стейт игрока.
 * Это делает логику детерминированной и юнит-тестируемой, а главное — гарантирует,
 * что клиент не может подсунуть своё время или стейт (docs/architecture.md → «сервер —
 * источник правды», docs/game-mechanics.md — формулы и фазы).
 */

import { weekInfo } from "./week";

// ---- Конфиг таймингов и экономики ----
// Демо-режим (GAME_MODE=demo) повторяет прототип: быстрый цикл для тестов петли.
// В проде переменная не выставлена → реальные 24ч/12ч.
const DEMO = process.env.GAME_MODE === "demo";

export const GAME = {
  /** Сколько машина заводится и стакает после кранка. */
  WIND_MS: DEMO ? 30_000 : 24 * 60 * 60 * 1000,
  /** Окно после завода, в которое надо перекранкать, иначе рейд. */
  GRACE_MS: DEMO ? 15_000 : 12 * 60 * 60 * 1000,
  /** Базовая ставка стека в секунду при streak=1 без буста. PLACEHOLDER — балансим позже. */
  BASE_RATE_PER_SEC: DEMO ? 5 : 0.01,
  /** Прибавка множителя за каждую единицу стрика (компаунд-эффект). */
  STREAK_STEP: 0.2,
  /**
   * Максимальный множитель за холд $VLTR — верхняя ступень лестницы `HOLDER_TIERS`.
   * Поднимать нельзя без пересчёта экономики призового пула
   * (docs/leaderboard-rewards.md): множитель решает, кто попадёт в топ-10.
   */
  BOOST_MULT: 5,
  /** Доля стека, которую скимит рейдер при простое. */
  SKIM: 0.15,
} as const;

// ---- Холдерский буст: лестница тиров по ДОЛЕ ОТ ЭМИССИИ ----
/**
 * Почему доля от эмиссии, а не абсолютное число токенов и не место среди игроков.
 *
 * Было: буст — булев флаг, `баланс >= 1 токена` → ×5. Экономически это тупик. Как только
 * ×5 есть у всех, множитель перестаёт различать игроков, и главное — купив ровно порог,
 * докупать больше НЕ ЗАЧЕМ: лишний токен не даёт ничего. Мем-токен, в котором нет причин
 * держать больше минимума, не растёт.
 *
 * Стало: лестница тиров, где ступенька — доля от общей эмиссии токена (в ppb).
 *  - «доля» и есть «сколько у тебя относительно остальных»: пирог фиксирован, и чем
 *    больше кусок у тебя, тем меньше у всех остальных. Растёт база холдеров — растёт и
 *    цена ступени, лестница сама подстраивается;
 *  - НЕ место среди игроков (перцентиль): регистрация бесплатна, и накрутив тысячу пустых
 *    сессий, любой поднял бы себе перцентиль. Долю от эмиссии подделать нельзя — обе
 *    величины читаются из чейна;
 *  - НЕ абсолютное число токенов: порог «1 000 000 $VLTR» устаревает при первом же
 *    изменении цены/эмиссии, и его пришлось бы вручную догонять.
 *
 * Кривая нарочно сильно вогнутая: ступени идут ×5 по бэгу, а множитель — примерно +35%.
 * От первой ступени до последней бэг больше в 500 раз, а ставка — всего в 3.3 раза.
 * Верх ограничен ×5 (было и осталось): у кита с 50% эмиссии тот же множитель, что у
 * холдера с 0.5%, иначе один кошелёк забирал бы пул навсегда и игра для остальных
 * заканчивалась.
 *
 * Побочно это закрывает и дешёвый сивил: раньше 10 кошельков по 1 токену давали ×5 каждый,
 * теперь на те же 10 кошельков с ×5 нужно 5% всей эмиссии. Дробить бэг стало невыгодно —
 * доля каждого кошелька падает, а вместе с ней и его тир.
 */
export interface HolderTier {
  level: number;
  /** Ярлык для UI (вестерн-лестница). */
  name: string;
  /**
   * Минимальная доля от эмиссии в ppb (parts per billion, 1e-9).
   * 10_000 ppb = 0.001% эмиссии. Целые ppb, чтобы граница тира была точной:
   * доля считается делением bigint на bigint, без float по дороге.
   */
  minPpb: number;
  /** Множитель ставки на этом тире. */
  mult: number;
}

export const HOLDER_TIERS: readonly HolderTier[] = [
  { level: 0, name: "DRIFTER", minPpb: 0, mult: 1 },
  { level: 1, name: "PROSPECTOR", minPpb: 10_000, mult: 1.5 }, // 0.001% эмиссии
  { level: 2, name: "RANCHER", minPpb: 50_000, mult: 2 }, // 0.005%
  { level: 3, name: "OUTLAW", minPpb: 200_000, mult: 2.75 }, // 0.02%
  { level: 4, name: "BARON", minPpb: 1_000_000, mult: 3.75 }, // 0.1%
  { level: 5, name: "TYCOON", minPpb: 5_000_000, mult: GAME.BOOST_MULT }, // 0.5%
] as const;

export const MAX_HOLDER_LEVEL = HOLDER_TIERS.length - 1;

/** 100% эмиссии в ppb — потолок доли. */
export const MAX_SHARE_PPB = 1_000_000_000;

/**
 * Нормализовать долю: мусор → 0, больше 100% эмиссии не бывает.
 * Верхняя граница не косметика: битый токен, отдающий `balanceOf > totalSupply`,
 * иначе прислал бы значение, не влезающее в `Int`-колонку стейта.
 */
export function clampSharePpb(ppb: unknown): number {
  if (typeof ppb !== "number" || !Number.isFinite(ppb) || ppb <= 0) return 0;
  return Math.min(ppb, MAX_SHARE_PPB);
}

/** ppb → проценты эмиссии (для показа игроку). 10_000 ppb = 0.001%. */
export function sharePctFromPpb(ppb: number): number {
  return ppb / 1e7;
}

/**
 * Результат серверного чтения чейна: тир и доля на момент чтения.
 * Хранится в стейте целиком — по `ppb` потом видно, ПОЧЕМУ выдан именно этот тир
 * (и можно нарисовать прогресс до следующего, не обращаясь к RPC на каждый поллинг).
 */
export interface HolderRead {
  tier: number;
  ppb: number;
}

/** Нормализовать уровень тира: мусор и выход за диапазон → 0 (fail closed, без буста). */
export function clampHolderLevel(level: unknown): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 0;
  return Math.min(Math.max(Math.trunc(level), 0), MAX_HOLDER_LEVEL);
}

export function holderTier(level: number): HolderTier {
  return HOLDER_TIERS[clampHolderLevel(level)];
}

/** Множитель за холд по уровню тира. */
export function holderMult(level: number): number {
  return holderTier(level).mult;
}

/** Уровень тира по доле от эмиссии. Сравнение по возрастанию порогов, граница включительно. */
export function holderTierFromPpb(ppb: number): number {
  if (typeof ppb !== "number" || !Number.isFinite(ppb) || ppb <= 0) return 0;
  let level = 0;
  for (const t of HOLDER_TIERS) {
    if (ppb >= t.minPpb) level = t.level;
  }
  return level;
}

/** Следующая ступень лестницы, либо null — уже верх. */
export function nextHolderTier(level: number): HolderTier | null {
  return HOLDER_TIERS[clampHolderLevel(level) + 1] ?? null;
}

export type Phase = "off" | "winding" | "ready" | "stall";

export interface PlayerState {
  /** Накопленный игровой стек $STACK. */
  stack: number;
  /** Текущий стрик (число заводов подряд в окне). */
  streak: number;
  /** Время последнего кранка (epoch ms) либо null, если машина ни разу не заводилась. */
  lastCrankAt: number | null;
  /** Время, до которого стек уже начислен (epoch ms). */
  lastSettleAt: number;
  /** Заведена ли машина сейчас. */
  machineOn: boolean;
  /**
   * Уровень холдерского тира, зафиксированный на текущий завод (0 — не холдит).
   * Ставит ТОЛЬКО сервер, прочитав баланс и эмиссию on-chain. Клиент не передаёт его никогда.
   */
  boostTier: number;
  /** Доля от эмиссии (ppb) на момент последнего успешного чтения — обоснование тира. */
  boostPpb: number;
  /**
   * Неделя борда, к которой относится база `weekStartStack` (см. lib/week.ts).
   * Ставит сервер: клиент это значение не передаёт никогда.
   */
  weekId: number;
  /**
   * Стек на момент начала недели. Ранг в борде считается как `stack - weekStartStack`,
   * то есть по ПРИРОСТУ за неделю. Личный стек при этом продолжает расти — от него
   * зависят тиры и скины, и обнулять их каждую субботу значило бы наказывать за стаж.
   */
  weekStartStack: number;
  /** Ник для лидерборда (уникальный, задаётся кошельком). null — не задан. */
  nickname: string | null;
  /** Скрыть адрес кошелька на борде. По умолчанию false — адрес открыт (прозрачность). */
  hideWallet: boolean;
}

export interface RaidEvent {
  /** Сколько стека забрал рейдер. */
  lost: number;
}

export interface SettleResult {
  state: PlayerState;
  /** Сколько стека начислено за этот settle. */
  accrued: number;
  /** Присутствует, если за этот settle машина простояла и случился рейд. */
  raid: RaidEvent | null;
}

// ---- Тиры машины (по стеку) ----
export interface Tier {
  name: string;
  at: number;
  /** Косметика: с этого тира монеты золотые. */
  gold: boolean;
}

export const TIERS: readonly Tier[] = [
  { name: "TIN CAN", at: 0, gold: false },
  { name: "SAFE", at: 500, gold: false },
  { name: "VAULT", at: 2500, gold: false },
  { name: "FORT", at: 10000, gold: true },
  { name: "GOLD RESERVE", at: 50000, gold: true },
] as const;

export function tierIndex(stack: number): number {
  let t = 0;
  for (let i = 0; i < TIERS.length; i++) {
    if (stack >= TIERS[i].at) t = i;
  }
  return t;
}

// ---- Экономика ----
/**
 * Итоговый множитель ставки: стрик (играешь каждый день) × холд (держишь токен).
 * Множители перемножаются, но растут по-разному: стрик — бесплатный и линейный,
 * холд — ограничен ×5 и требует всё большей доли эмиссии за каждую ступень.
 */
export function multiplier(streak: number, boostTier: number): number {
  return (1 + streak * GAME.STREAK_STEP) * holderMult(boostTier);
}

/** Ставка стека в секунду при данном стрике/тире холда. */
export function ratePerSec(streak: number, boostTier: number): number {
  return GAME.BASE_RATE_PER_SEC * multiplier(streak, boostTier);
}

// ---- Фаза петли ----
export function phase(state: PlayerState, now: number): Phase {
  if (!state.machineOn || state.lastCrankAt === null) return "off";
  const dt = now - state.lastCrankAt;
  if (dt < GAME.WIND_MS) return "winding";
  if (dt < GAME.WIND_MS + GAME.GRACE_MS) return "ready";
  return "stall";
}

/**
 * Начислить офлайн-стек и, если машина простояла окно, применить рейд.
 * Идемпотентно относительно `lastSettleAt`: повторный вызов с тем же `now` ничего не добавит.
 *
 * Помимо начисления, здесь же фиксируется база недели (`weekStartStack`) — см. `rebase`.
 * Это сделано внутри `settle`, а не в роутах, специально: `settle` вызывают все пути
 * (кранк, чтение стейта, борд, обновление буста), и ни один из них не может «забыть»
 * перевести игрока на новую неделю.
 */
export function settle(prev: PlayerState, now: number): SettleResult {
  const wk = weekInfo(now);
  let state: PlayerState = { ...prev };
  let accrued = 0;
  let raid: RaidEvent | null = null;

  if (state.weekId !== wk.weekId) {
    // Докручиваем ровно до субботней полуночи, чтобы база была стеком НА МОМЕНТ границы,
    // а не тем, что накапало уже на новой неделе. Иначе игрок, у которого машина
    // работала через границу, унёс бы часть прошлой недели в зачёт новой.
    // Условие про lastSettleAt: назад время не двигаем (это сломало бы идемпотентность);
    // если стейт уже посчитан за границу, берём текущий стек — в пользу борда, не игрока.
    if (wk.startsAt > state.lastSettleAt) {
      const toBoundary = advance(state, wk.startsAt);
      state = toBoundary.state;
      accrued += toBoundary.accrued;
      raid = toBoundary.raid ?? raid;
    }
    state.weekId = wk.weekId;
    state.weekStartStack = state.stack;
  }

  const rest = advance(state, now);
  state = rest.state;
  accrued += rest.accrued;
  raid = rest.raid ?? raid;

  return { state, accrued, raid };
}

/** Начисление и рейд до момента `to`. Без недельной логики — её добавляет `settle`. */
function advance(prev: PlayerState, to: number): SettleResult {
  const state: PlayerState = { ...prev };
  const now = to;
  let accrued = 0;
  let raid: RaidEvent | null = null;

  if (state.machineOn && state.lastCrankAt !== null) {
    const windEnd = state.lastCrankAt + GAME.WIND_MS;
    // Начисляем только за отрезок внутри окна завода, ещё не начисленный.
    const from = Math.max(state.lastSettleAt, state.lastCrankAt);
    const to = Math.min(now, windEnd);
    if (to > from) {
      accrued = ratePerSec(state.streak, state.boostTier) * ((to - from) / 1000);
      state.stack += accrued;
    }
    // Простой: не перекранкали за WIND+GRACE → рейдер скимит один раз.
    if (now >= state.lastCrankAt + GAME.WIND_MS + GAME.GRACE_MS) {
      const lost = state.stack * GAME.SKIM;
      state.stack -= lost;
      state.machineOn = false;
      state.streak = 0;
      state.lastCrankAt = null;
      raid = { lost };
    }
  }

  state.lastSettleAt = now;
  return { state, accrued, raid };
}

export interface CrankResult {
  ok: boolean;
  /** Причина отказа, если ok=false. */
  reason?: "winding";
  /**
   * Фаза, в которой застали машину на момент попытки — после settle, до завода.
   * Нужна для аудита (`CrankLog`): по ней видно, что именно сервер видел.
   * Внимание: если settle только что применил рейд, он гасит машину, и фаза здесь
   * будет "off", а не "stall" — сам факт простоя виден по `raid`.
   */
  phaseAt: Phase;
  state: PlayerState;
  /** Событие рейда, если settle перед кранком обнаружил простой. */
  raid: RaidEvent | null;
}

/**
 * Выполнить кранк. Сначала settle (докидываем стек / разрешаем рейд),
 * затем валидируем фазу и заводим машину.
 * Во время завода (winding) кранк ОТКЛОНЯЕТСЯ — нельзя ускорить время.
 *
 * `nextHolder` — свежепрочитанный on-chain тир холда на предстоящий завод.
 * `undefined`/`null` означают «не проверяли / не смогли прочитать» → оставляем как было
 * (сетевой сбой не должен снимать буст у холдера).
 */
export function crank(
  prev: PlayerState,
  now: number,
  nextHolder?: HolderRead | null,
): CrankResult {
  const settled = settle(prev, now);
  const state = settled.state;
  const p = phase(state, now);

  if (p === "winding") {
    // Кранк отклонён — ставка текущего завода уже зафиксирована, тир не трогаем.
    return { ok: false, reason: "winding", phaseAt: p, state, raid: settled.raid };
  }

  // Тир применяем СТРОГО после settle: он задаёт ставку на следующий завод и не должен
  // задним числом пересчитывать уже начисленный отрезок по новому множителю.
  if (nextHolder !== undefined && nextHolder !== null) {
    state.boostTier = clampHolderLevel(nextHolder.tier);
    state.boostPpb = clampSharePpb(nextHolder.ppb);
  }

  if (p === "ready") {
    // Вернулся в окне — стрик растёт (компаунд).
    state.streak += 1;
  } else {
    // 'off' (в т.ч. только что зарейженная машина) → свежий старт.
    state.streak = 1;
  }

  state.machineOn = true;
  state.lastCrankAt = now;
  state.lastSettleAt = now;

  return { ok: true, phaseAt: p, state, raid: settled.raid };
}

/** Свежий стейт для нового игрока. */
export function initialState(now: number): PlayerState {
  return {
    stack: 0,
    streak: 0,
    lastCrankAt: null,
    lastSettleAt: now,
    machineOn: false,
    boostTier: 0,
    boostPpb: 0,
    weekId: weekInfo(now).weekId,
    weekStartStack: 0,
    nickname: null,
    hideWallet: false,
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/**
 * Привести запись из хранилища к текущему `PlayerState`.
 *
 * Нужна там, где стейт приходит из формата, который мог быть записан другой версией схемы
 * (файловый стор — обычный JSON). Чужому/старому полю не доверяем: неизвестное значение
 * тира трактуем как «буста нет» — ошибка в эту сторону никому не выдаёт лишнего ×5.
 * Легаси-флаг `boost: true` поднимаем только до ПЕРВОЙ ступени: реальную долю всё равно
 * перечитает следующий кранк (docs/game-mechanics.md → инвариант буста).
 */
export function hydrateState(raw: unknown, now: number): PlayerState {
  const base = initialState(now);
  if (raw === null || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  const legacyBoost = r.boost === true;
  const tier =
    r.boostTier === undefined && legacyBoost ? 1 : clampHolderLevel(r.boostTier);

  return {
    stack: num(r.stack, 0),
    streak: num(r.streak, 0),
    lastCrankAt: typeof r.lastCrankAt === "number" && Number.isFinite(r.lastCrankAt)
      ? r.lastCrankAt
      : null,
    lastSettleAt: num(r.lastSettleAt, now),
    machineOn: r.machineOn === true,
    boostTier: tier,
    boostPpb: clampSharePpb(r.boostPpb),
    // Записи без недели (старый формат) получают weekId 0 — он заведомо не совпадёт
    // с текущим, и первый же settle честно зафиксирует базу.
    weekId: num(r.weekId, 0),
    weekStartStack: Math.max(0, num(r.weekStartStack, 0)),
    nickname: typeof r.nickname === "string" ? r.nickname : null,
    hideWallet: r.hideWallet === true,
  };
}

// ---- Производные значения для UI (считаются на сервере, отдаются клиенту) ----
/** Ступень лестницы холда в виде, готовом к отрисовке. */
export interface HolderTierView {
  level: number;
  name: string;
  mult: number;
  /** Порог ступени в процентах эмиссии. */
  sharePct: number;
}

export interface PublicView {
  stack: number;
  streak: number;
  multiplier: number;
  ratePerSec: number;
  phase: Phase;
  tierIndex: number;
  tierName: string;
  /** Порог, с которого начинается текущий тир (для прогресса заполнения монетами). */
  tierAt: number;
  /** Косметика: с этого тира монеты золотые (иначе серебряные). */
  gold: boolean;
  nextTierAt: number | null;
  nextTierName: string | null;
  /** Мс до конца текущей фазы (winding/ready), иначе null. */
  phaseEndsInMs: number | null;
  /** Есть ли холдерский буст вообще (тир > 0). Оставлено для простых проверок в UI и e2e. */
  boost: boolean;
  /** Текущая ступень лестницы холда. */
  holder: HolderTierView;
  /** Следующая ступень и что она даст, либо null — игрок на вершине. */
  nextHolder: HolderTierView | null;
  /** Своя доля от эмиссии в процентах на момент последнего чтения чейна. */
  holderSharePct: number;
  /** Стек, набранный за текущую неделю борда — именно он определяет место в топ-10. */
  weekStack: number;
  serverNow: number;
}

/**
 * Вся лестница в виде для UI. Данные статические, поэтому уходят на клиент один раз
 * пропсом со серверного компонента страницы, а не в каждом ответе поллинга.
 */
export function holderLadder(): HolderTierView[] {
  return HOLDER_TIERS.map(toHolderView);
}

function toHolderView(t: HolderTier): HolderTierView {
  return {
    level: t.level,
    name: t.name,
    mult: t.mult,
    sharePct: sharePctFromPpb(t.minPpb),
  };
}

export function toPublicView(state: PlayerState, now: number): PublicView {
  const p = phase(state, now);
  const ti = tierIndex(state.stack);
  const next = TIERS[ti + 1] ?? null;

  let phaseEndsInMs: number | null = null;
  if (state.lastCrankAt !== null) {
    if (p === "winding") phaseEndsInMs = state.lastCrankAt + GAME.WIND_MS - now;
    else if (p === "ready") phaseEndsInMs = state.lastCrankAt + GAME.WIND_MS + GAME.GRACE_MS - now;
  }

  const level = clampHolderLevel(state.boostTier);
  const nextTier = nextHolderTier(level);

  return {
    stack: state.stack,
    streak: state.streak,
    multiplier: multiplier(state.streak, level),
    ratePerSec: ratePerSec(state.streak, level),
    phase: p,
    tierIndex: ti,
    tierName: TIERS[ti].name,
    tierAt: TIERS[ti].at,
    gold: TIERS[ti].gold,
    nextTierAt: next?.at ?? null,
    nextTierName: next?.name ?? null,
    phaseEndsInMs,
    boost: level > 0,
    holder: toHolderView(holderTier(level)),
    nextHolder: nextTier ? toHolderView(nextTier) : null,
    holderSharePct: sharePctFromPpb(state.boostPpb),
    weekStack: Math.max(0, state.stack - state.weekStartStack),
    serverNow: now,
  };
}

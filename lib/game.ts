/**
 * VAULTLER — ядро игровой механики (server-authoritative).
 *
 * Чистые функции: НЕ читают время из окружения, НЕ трогают БД.
 * Вызывающий код передаёт `now` (серверный Date.now()) и текущий стейт игрока.
 * Это делает логику детерминированной и юнит-тестируемой, а главное — гарантирует,
 * что клиент не может подсунуть своё время или стейт (docs/architecture.md → «сервер —
 * источник правды», docs/game-mechanics.md — формулы и фазы).
 */

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
   * Множитель ставки за холд $VLTR (читается on-chain). Не-холдер стакает на ×1.
   * ×5 сделан большим намеренно: чтобы попасть в топ-10 (который делит недельный пул
   * из фисов) практически необходимо холдить. Это и есть двигатель покупок → объёма → фисов.
   */
  BOOST_MULT: 5,
  /** Доля стека, которую скимит рейдер при простое. */
  SKIM: 0.15,
} as const;

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
  /** Активен ли буст за холд $VLTR (M1: всегда false). */
  boost: boolean;
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
export function multiplier(streak: number, boost: boolean): number {
  return (1 + streak * GAME.STREAK_STEP) * (boost ? GAME.BOOST_MULT : 1);
}

/** Ставка стека в секунду при данном стрике/бусте. */
export function ratePerSec(streak: number, boost: boolean): number {
  return GAME.BASE_RATE_PER_SEC * multiplier(streak, boost);
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
 */
export function settle(prev: PlayerState, now: number): SettleResult {
  const state: PlayerState = { ...prev };
  let accrued = 0;
  let raid: RaidEvent | null = null;

  if (state.machineOn && state.lastCrankAt !== null) {
    const windEnd = state.lastCrankAt + GAME.WIND_MS;
    // Начисляем только за отрезок внутри окна завода, ещё не начисленный.
    const from = Math.max(state.lastSettleAt, state.lastCrankAt);
    const to = Math.min(now, windEnd);
    if (to > from) {
      accrued = ratePerSec(state.streak, state.boost) * ((to - from) / 1000);
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
 */
export function crank(prev: PlayerState, now: number): CrankResult {
  const settled = settle(prev, now);
  const state = settled.state;
  const p = phase(state, now);

  if (p === "winding") {
    return { ok: false, reason: "winding", phaseAt: p, state, raid: settled.raid };
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
    boost: false,
    nickname: null,
    hideWallet: false,
  };
}

// ---- Производные значения для UI (считаются на сервере, отдаются клиенту) ----
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
  boost: boolean;
  serverNow: number;
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

  return {
    stack: state.stack,
    streak: state.streak,
    multiplier: multiplier(state.streak, state.boost),
    ratePerSec: ratePerSec(state.streak, state.boost),
    phase: p,
    tierIndex: ti,
    tierName: TIERS[ti].name,
    tierAt: TIERS[ti].at,
    gold: TIERS[ti].gold,
    nextTierAt: next?.at ?? null,
    nextTierName: next?.name ?? null,
    phaseEndsInMs,
    boost: state.boost,
    serverNow: now,
  };
}

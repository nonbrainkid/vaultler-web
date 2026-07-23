/**
 * Лидерборд и «общий сейф» — считаются на сервере из снапшота всех игроков.
 * Каждому игроку применяем settle на текущий момент, чтобы цифры были честные
 * (у зарейженных/накапавших — актуальные), а не устаревший stored-stack.
 *
 * Приватность: наружу отдаём только ярлык (короткий адрес или «anon»), без сырых id.
 */
import { settle, type PlayerState } from "./game";
import { addressFromIdentity } from "./auth";
import type { PlayerSnapshot } from "./store";

// Недельный цикл пула. Якорь — понедельник 2024-01-01 00:00 UTC.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const WEEK_ANCHOR = Date.UTC(2024, 0, 1);

export interface WeekInfo {
  weekId: number;
  endsInMs: number;
}

export function weekInfo(now: number): WeekInfo {
  const weekId = Math.floor((now - WEEK_ANCHOR) / WEEK_MS);
  const endsInMs = WEEK_ANCHOR + (weekId + 1) * WEEK_MS - now;
  return { weekId, endsInMs };
}

export interface LeaderRow {
  rank: number;
  label: string;
  kind: "wallet" | "anon";
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

function labelFor(identity: string): { label: string; kind: "wallet" | "anon" } {
  const addr = addressFromIdentity(identity);
  return addr ? { label: shortAddr(addr), kind: "wallet" } : { label: "anon", kind: "anon" };
}

export function buildLeaderboard(
  snapshot: PlayerSnapshot[],
  now: number,
  meIdentity: string,
  limit = 10,
): LeaderboardView {
  // живой стек каждого через settle
  const live = snapshot.map((p) => {
    const state: PlayerState = settle(p.state, now).state;
    return { identity: p.identity, stack: state.stack, streak: state.streak };
  });

  live.sort((a, b) => b.stack - a.stack);

  const communalVault = live.reduce((sum, p) => sum + p.stack, 0);

  const top: LeaderRow[] = live.slice(0, limit).map((p, i) => ({
    rank: i + 1,
    ...labelFor(p.identity),
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

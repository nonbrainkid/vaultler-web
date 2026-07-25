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

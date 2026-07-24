"use client";

import { useCallback, useEffect, useState } from "react";

interface LeaderRow {
  rank: number;
  label: string;
  kind: "wallet" | "anon" | "bot";
  stack: number;
  streak: number;
  isYou: boolean;
}
interface LeaderboardView {
  communalVault: number;
  players: number;
  top: LeaderRow[];
  you: { rank: number; stack: number } | null;
  week: { weekId: number; endsInMs: number };
}

function fmt(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}
function fmtWeek(ms: number): string {
  if (ms <= 0) return "0h";
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d}d ${h % 24}h`;
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export default function Leaderboard({
  refreshKey,
  onRank,
}: {
  refreshKey: number;
  /** Ранг и размер комьюнити наверх — от них зависит скин сейфа в игре. */
  onRank?: (rank: number | null, players: number) => void;
}) {
  const [lb, setLb] = useState<LeaderboardView | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!r.ok) throw new Error("bad status");
      const data: LeaderboardView = await r.json();
      setLb(data);
      setFailed(false);
      onRank?.(data.you?.rank ?? null, data.players ?? 0);
    } catch {
      setFailed(true); // прошлые данные оставляем на экране
    }
  }, [onRank]);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  // перезагрузка, когда родитель дёрнул refreshKey (после кранка стек меняется)
  useEffect(() => {
    if (refreshKey > 0) load();
  }, [refreshKey, load]);

  const youInTop = lb?.top.some((r) => r.isYou);

  return (
    <div className="pool ledger">
      <div className="top">
        <span className="lab">COMMUNITY VAULT</span>
        <span className="amt">{lb ? fmt(lb.communalVault) : "—"} $STACK</span>
      </div>
      <div className="subline">
        Everyone stacking feeds it. Weekly pool from <b>creator fees</b> · resets in{" "}
        <b>{lb ? fmtWeek(lb.week.endsInMs) : "—"}</b> · <b>{lb?.players ?? 0}</b> stackers
      </div>

      {failed && (
        <p className="lb-err" role="alert">
          Board is out of reach right now — showing the last snapshot.
        </p>
      )}

      <div className="lbrows" aria-busy={!lb}>
        {!lb && !failed ? (
          <>
            {[0, 1, 2].map((i) => (
              <div className="lbrow skeleton" key={i} aria-hidden="true">
                <span className="lbrank">–</span>
                <span className="lblabel">loading…</span>
                <span className="lbstreak" />
                <span className="lbstack">—</span>
              </div>
            ))}
          </>
        ) : lb && lb.top.length > 0 ? (
          lb.top.map((r) => (
            <div key={r.rank} className={"lbrow" + (r.isYou ? " you" : "")}>
              <span className="lbrank">{r.rank}</span>
              <span className="lblabel">
                {r.label}
                {r.isYou ? " (you)" : ""}
                {r.kind === "bot" && <em className="botmark">test</em>}
              </span>
              <span className="lbstreak">×{r.streak}</span>
              <span className="lbstack">{fmt(r.stack)}</span>
            </div>
          ))
        ) : (
          <div className="lbempty">no stackers yet — be the first to crank</div>
        )}

        {lb?.you && !youInTop && (
          <div className="lbrow you outside">
            <span className="lbrank">{lb.you.rank}</span>
            <span className="lblabel">you</span>
            <span className="lbstreak" />
            <span className="lbstack">{fmt(lb.you.stack)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

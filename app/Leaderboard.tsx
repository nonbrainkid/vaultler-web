"use client";

import { useCallback, useEffect, useState } from "react";

const EXPLORER = process.env.NEXT_PUBLIC_RH_EXPLORER || "";

interface LeaderRow {
  rank: number;
  label: string;
  kind: "wallet" | "anon" | "bot";
  address: string | null;
  stack: number;
  streak: number;
  isYou: boolean;
  /** Подтверждённый кошелёк — только такие места делят пул. */
  eligible: boolean;
  /** Место в призовой зоне; null — вне денег. Не равно `rank`. */
  moneyRank: number | null;
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}
interface LeaderboardView {
  communalVault: number;
  players: number;
  top: LeaderRow[];
  you: {
    rank: number;
    stack: number;
    eligible: boolean;
    moneyRank: number | null;
  } | null;
  week: { weekId: number; endsInMs: number };
  payoutSeats: number;
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
        The <b>top 10</b> split the weekly pool — half of the token&apos;s trading fees,
        paid in real tokens. Resets <b>Saturday 00:00 New York</b>, in{" "}
        <b>{lb ? fmtWeek(lb.week.endsInMs) : "—"}</b> · <b>{lb?.players ?? 0}</b> stackers
      </div>
      <div className="paidzone">
        ▸ the top <b>{lb?.payoutSeats ?? 10}</b> connected wallets are in the money ·
        ranked by $STACK earned <b>this week</b>
      </div>
      <div className="subline">
        Anyone can play and climb. A payout needs a connected wallet — there is nowhere
        to send tokens otherwise.
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
            <div
              key={r.rank}
              className={
                "lbrow" +
                (r.isYou ? " you" : "") +
                // «В деньгах» — не первые десять строк, а первые десять подтверждённых
                // кошельков: подсветка обязана совпадать с тем, кому реально платят.
                (r.moneyRank !== null ? " paid" : "") +
                (r.eligible ? "" : " noteligible")
              }
            >
              <span className="lbrank">{r.rank}</span>
              <span className="lblabel">
                {/* если ника нет, label уже равен короткому адресу — не дублируем,
                    показываем только кликабельный адрес ниже */}
                {!(r.address && r.label === shortAddr(r.address)) && r.label}
                {r.isYou ? " (you)" : ""}
                {r.kind === "bot" && <em className="botmark">test</em>}
                {r.kind === "anon" && (
                  <em className="nowallet" title="No wallet connected — cannot be paid">
                    no wallet
                  </em>
                )}
                {r.address &&
                  (EXPLORER ? (
                    <a
                      className="addrlink"
                      href={`${EXPLORER.replace(/\/$/, "")}/address/${r.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={r.address}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {shortAddr(r.address)} ↗
                    </a>
                  ) : (
                    <em className="addrlink" title={r.address}>
                      {shortAddr(r.address)}
                    </em>
                  ))}
              </span>
              <span className="lbstreak">×{r.streak}</span>
              <span className="lbstack">{fmt(r.stack)}</span>
            </div>
          ))
        ) : (
          <div className="lbempty">no stackers yet — be the first to crank</div>
        )}

        {lb?.you && !youInTop && (
          <div className={"lbrow you outside" + (lb.you.eligible ? "" : " noteligible")}>
            <span className="lbrank">{lb.you.rank}</span>
            <span className="lblabel">
              you — {Math.max(1, lb.you.rank - lb.payoutSeats)} off the top{" "}
              {lb.payoutSeats}
            </span>
            <span className="lbstreak" />
            <span className="lbstack">{fmt(lb.you.stack)}</span>
          </div>
        )}
      </div>

      {/* Своё место видно, а платить некуда — самый важный экран для конверсии в кошелёк:
          игрок уже вложился временем, и именно здесь ему стоит сказать, чего не хватает. */}
      {lb?.you && !lb.you.eligible && (
        <p className="lb-cta">
          You&apos;re #{lb.you.rank} — but a payout needs a wallet. Connect one and you&apos;re
          in the running.
        </p>
      )}
    </div>
  );
}

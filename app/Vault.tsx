"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicView } from "@/lib/game";
import Wallet from "./Wallet";
import Leaderboard from "./Leaderboard";

// Палитра пиксельного сейфа по тиру (косметика; авторитетный стек — с сервера).
const VAULT_SKINS = [
  { body: "#9a9384", trim: "#6f6a5c", face: "#b8b1a1" }, // TIN CAN
  { body: "#7a4a2a", trim: "#43271a", face: "#95633a" }, // SAFE
  { body: "#5a6b74", trim: "#33414a", face: "#76888f" }, // VAULT
  { body: "#46505a", trim: "#a9782a", face: "#5c6772" }, // FORT
  { body: "#caa23e", trim: "#7a5a1e", face: "#e6c25a" }, // GOLD RESERVE
];

const COIN_CAP = [10, 22, 40, 64, 90];

interface StateResponse {
  view: PublicView;
  raid: { lost: number } | null;
  wallet?: string | null;
}
interface CrankResponse extends StateResponse {
  ok: boolean;
  reason: string | null;
}

function fmt(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

/** мс → компактный таймер: <60с как "12s", иначе "3h 12m" / "12m 30s". */
function fmtLeft(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function Vault() {
  const [view, setView] = useState<PublicView | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [lbKey, setLbKey] = useState(0); // сигнал лидерборду перезагрузиться
  const [recvAt, setRecvAt] = useState(0); // Date.now() приёма ответа
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const flashRef = useRef<HTMLDivElement>(null);
  const chamberRef = useRef<HTMLDivElement>(null);
  const reduced = useRef(false);
  const lastDrop = useRef(0);

  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const applyResponse = useCallback((data: StateResponse) => {
    setView(data.view);
    if (data.wallet !== undefined) setWallet(data.wallet);
    setRecvAt(Date.now());
    if (data.raid && data.raid.lost > 0) triggerFlash();
  }, []);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.ok) applyResponse(await r.json());
    } catch {
      /* оффлайн — оставляем последнее состояние */
    }
  }, [applyResponse]);

  const doCrank = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/crank", { method: "POST", cache: "no-store" });
      if (r.ok) {
        applyResponse((await r.json()) as CrankResponse);
        setLbKey((k) => k + 1); // стек изменился — обновим лидерборд
      }
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  }, [busy, applyResponse]);

  // первичная загрузка + поллинг + рефетч при возврате на вкладку
  useEffect(() => {
    refetch();
    const poll = setInterval(refetch, 2500);
    const onVis = () => {
      if (document.visibilityState === "visible") refetch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refetch]);

  // локальный тик для плавного таймера/интерполяции стека —
  // только когда есть что анимировать (winding/ready). В off/stall не тикаем.
  const activePhase = view?.phase === "winding" || view?.phase === "ready";
  useEffect(() => {
    if (!activePhase) return;
    const id = setInterval(() => setNow(Date.now()), reduced.current ? 1000 : 250);
    return () => clearInterval(id);
  }, [activePhase]);

  // производные для отрисовки (косметическая интерполяция поверх серверной правды)
  const d = useMemo(() => {
    if (!view) return null;
    const elapsed = Math.max(0, now - recvAt) / 1000; // сек с момента ответа
    let stack = view.stack;
    let endsIn = view.phaseEndsInMs;
    if (view.phase === "winding") {
      // докручиваем стек локально, но не дольше, чем длится завод
      const cap = (view.phaseEndsInMs ?? 0) / 1000;
      stack += view.ratePerSec * Math.min(elapsed, cap);
    }
    if (endsIn != null) endsIn = Math.max(0, endsIn - (now - recvAt));
    return { stack, endsIn };
  }, [view, now, recvAt]);

  function triggerFlash() {
    const el = flashRef.current;
    if (!el || reduced.current) return;
    el.classList.remove("go");
    void el.offsetWidth;
    el.classList.add("go");
  }

  // капающие монеты во время завода (косметика)
  useEffect(() => {
    if (!view || view.phase !== "winding" || reduced.current) return;
    const t = now;
    if (t - lastDrop.current < 520) return;
    lastDrop.current = t;
    const ch = chamberRef.current;
    if (!ch) return;
    const drop = document.createElement("div");
    drop.className = "drop" + (view.gold ? "" : " silver");
    drop.style.left = 30 + Math.random() * 45 + "%";
    ch.appendChild(drop);
    setTimeout(() => drop.remove(), 520);
  }, [now, view]);

  const skin = VAULT_SKINS[view?.tierIndex ?? 0];

  // число монет в камере
  const coinCount = useMemo(() => {
    if (!view || d == null || d.stack <= 0) return 0;
    const cap = COIN_CAP[view.tierIndex];
    const span = (view.nextTierAt ?? d.stack * 2) - view.tierAt;
    const prog = span > 0 ? Math.min(1, (d.stack - view.tierAt) / span) : 1;
    return Math.max(4, Math.round(cap * prog));
  }, [view, d]);

  // маппинг множителя в угол стрелки гейджа (mult ~1..4 → -90..+90)
  const gaugeAngle = view ? -90 + Math.min(1, (view.multiplier - 1) / 3) * 180 : -90;

  const phase = view?.phase ?? "off";
  const machineClass =
    "machine" + (phase === "winding" ? " winding" : "") + (phase === "stall" ? " stalled" : "");

  // статус + подписи кнопки
  let statusClass = "status";
  let statusText = "loading…";
  let crankLabel = "CRANK";
  let crankHint = "start the machine";
  let crankDisabled = busy;
  let crankDanger = false;

  if (view) {
    if (phase === "off") {
      statusText = "machine is off";
      crankLabel = "CRANK";
      crankHint = "start the machine";
    } else if (phase === "winding") {
      statusText = `STACKING · ${fmtLeft(d?.endsIn ?? 0)} left`;
      crankLabel = "WINDING…";
      crankHint = "already winding — come back at 0";
      crankDisabled = true;
    } else if (phase === "ready") {
      statusClass += " ready";
      statusText = `CRANK NOW · ${fmtLeft(d?.endsIn ?? 0)} before the raider`;
      crankLabel = "CRANK";
      crankHint = "+1 streak · multiplier up";
    } else {
      statusClass += " stall";
      statusText = "RAIDED — machine stalled, streak lost";
      crankLabel = "RESTART";
      crankHint = "streak resets to 1";
      crankDanger = true;
    }
  }

  return (
    <>
      <div className="flash" ref={flashRef} aria-hidden="true" />
      <div className="wrap">
        <header className="poster">
          <div className="kicker">Wind it. It stacks while you sleep.</div>
          <h1>THE VAULTLER</h1>
          <div className="sub">Trading is cope. Depositing is based.</div>
        </header>

        <div className="tierbar">
          <div className="tier-name">
            <span className="n">TIER {String((view?.tierIndex ?? 0) + 1).padStart(2, "0")}</span>
            {view?.tierName ?? "TIN CAN"}
          </div>
          <div className="tier-next">
            {view?.nextTierName ? (
              <>
                next: {view.nextTierName}
                <br />
                <b>{fmt(view.nextTierAt ?? 0)}</b> stack
              </>
            ) : (
              <>
                <b>MAX TIER</b>
                <br />
                certified stacker
              </>
            )}
          </div>
        </div>

        <div className={machineClass}>
          <div className="machine-top">
            <div className="vault" aria-hidden="true">
              <svg viewBox="0 0 128 128" shapeRendering="crispEdges">
                {/* корпус */}
                <rect x="10" y="14" width="108" height="100" fill={skin.trim} />
                <rect x="16" y="20" width="96" height="88" fill={skin.body} />
                {/* заклёпки по углам */}
                {[
                  [24, 28],
                  [98, 28],
                  [24, 96],
                  [98, 96],
                ].map(([x, y], i) => (
                  <rect key={i} x={x} y={y} width="6" height="6" fill={skin.trim} />
                ))}
                {/* лицо двери */}
                <rect x="34" y="34" width="60" height="60" fill={skin.face} />
                {/* вращающийся диск-замок */}
                <g className="dial">
                  <rect x="44" y="44" width="40" height="40" fill={skin.trim} />
                  <rect x="50" y="50" width="28" height="28" fill={skin.body} />
                  {/* спицы */}
                  <rect x="62" y="38" width="4" height="14" fill={skin.trim} />
                  <rect x="62" y="76" width="4" height="14" fill={skin.trim} />
                  <rect x="38" y="62" width="14" height="4" fill={skin.trim} />
                  <rect x="76" y="62" width="14" height="4" fill={skin.trim} />
                  {/* ступица */}
                  <rect x="59" y="59" width="10" height="10" fill={skin.face} />
                </g>
              </svg>
            </div>

            <div className="chamber" ref={chamberRef}>
              {coinCount > 0 ? (
                <div className="coins">
                  {Array.from({ length: coinCount }).map((_, i) => (
                    <span key={i} className={"coin" + (view?.gold ? "" : " silver")} />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  machine is off —<br />
                  crank to start stacking
                </div>
              )}
            </div>
          </div>

          <div className="readouts">
            <div className="ro">
              <div className="lab">STACK</div>
              <div className="val">{fmt(d?.stack ?? 0)}</div>
            </div>
            <div className="ro streak">
              <div className="lab">STREAK</div>
              <div className="val">{view?.streak ?? 0}</div>
            </div>
            <div className="ro">
              <div className="lab">×MULT</div>
              <div className="val">{(view?.multiplier ?? 1).toFixed(1)}</div>
            </div>
          </div>

          {/* мини-гейдж скорости */}
          <div style={{ marginTop: 11 }}>
            <svg viewBox="0 0 200 30" style={{ width: "100%", display: "block" }} aria-hidden="true">
              <rect x="4" y="20" width="192" height="6" fill="#0e0904" />
              <rect
                x="4"
                y="20"
                width={Math.min(1, ((view?.multiplier ?? 1) - 1) / 3) * 192}
                height="6"
                fill="var(--gold)"
              />
              <rect
                x={4 + Math.min(1, ((view?.multiplier ?? 1) - 1) / 3) * 192 - 2}
                y="14"
                width="6"
                height="12"
                fill="var(--gold-hi)"
              />
            </svg>
          </div>

          <div className={statusClass} role="status" aria-live="polite">
            {statusText}
          </div>
        </div>

        <button
          className={"crank" + (crankDanger ? " danger" : "")}
          onClick={doCrank}
          disabled={crankDisabled}
        >
          {crankLabel}
          <span className="hint">{crankHint}</span>
        </button>

        <Wallet serverAddress={wallet} boost={view?.boost ?? false} onChanged={refetch} />

        <Leaderboard refreshKey={lbKey} />

        <div className="foot">
          SERVER-AUTHORITATIVE · NOT FINANCIAL ADVICE · NO CUSTODY OF FUNDS
        </div>
      </div>
    </>
  );
}

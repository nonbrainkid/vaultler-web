"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PublicView } from "@/lib/game";
import ConnectButton from "./components/ConnectButton";
import ProfileEditor from "./components/ProfileEditor";
import SafeSprite from "./components/SafeSprite";
import { RANK_SKINS, rankLevel, nextSkin } from "@/lib/skins";

const COIN_CAP = [10, 22, 40, 64, 90];

interface StateResponse {
  view: PublicView;
  raid: { lost: number } | null;
  wallet?: string | null;
  nickname?: string | null;
  hideWallet?: boolean;
}
interface CrankResponse extends StateResponse {
  ok: boolean;
  reason: string | null;
}

function fmt(n: number): string {
  return Math.floor(n).toLocaleString("en-US");
}

function fmtLeft(ms: number): string {
  if (ms <= 0) return "0s";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function Vault({
  rank = null,
  players = 0,
  onStackChanged,
}: {
  /** Место в недельном борде — определяет скин сейфа. */
  rank?: number | null;
  /** Размер комьюнити — от него зависит, какие скины вообще открыты. */
  players?: number;
  onStackChanged?: () => void;
}) {
  const [view, setView] = useState<PublicView | null>(null);
  const [wallet, setWallet] = useState<string | null>(null);
  const [nickname, setNickname] = useState<string | null>(null);
  const [hideWallet, setHideWallet] = useState(false);
  const [recvAt, setRecvAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [boostBusy, setBoostBusy] = useState(false);
  /** Баланс прочитать не удалось — показываем последнее известное значение как неточное. */
  const [boostStale, setBoostStale] = useState(false);
  const [netErr, setNetErr] = useState(false);
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
    if (data.nickname !== undefined) setNickname(data.nickname);
    if (data.hideWallet !== undefined) setHideWallet(data.hideWallet);
    setRecvAt(Date.now());
    if (data.raid && data.raid.lost > 0) triggerFlash();
  }, []);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (!r.ok) throw new Error("bad status");
      applyResponse(await r.json());
      setNetErr(false);
    } catch {
      // оффлайн/сервер лёг — показываем баннер, последнее состояние оставляем на экране
      setNetErr(true);
    }
  }, [applyResponse]);

  /**
   * Перечитать баланс $VLTR прямо сейчас. Нужен потому, что буст фиксируется на кранке:
   * купив токен сразу после завода, игрок иначе не увидел бы ×5 до следующего кранка
   * и решил бы, что буст не работает.
   */
  const recheckBoost = useCallback(async () => {
    if (boostBusy) return;
    setBoostBusy(true);
    try {
      const r = await fetch("/api/boost/refresh", { method: "POST", cache: "no-store" });
      // 429 — не сбой сети, а наш собственный интервал между чтениями баланса
      // (сервер бережёт RPC). Красный баннер «нет связи» тут врал бы: связь есть,
      // просто рановато. Оставляем экран как есть — кнопку можно нажать чуть позже.
      if (r.status === 429) return;
      if (!r.ok) throw new Error("boost refresh failed");
      const d = (await r.json()) as StateResponse & { stale?: boolean };
      applyResponse(d);
      setBoostStale(Boolean(d.stale));
      setNetErr(false);
    } catch {
      setNetErr(true);
    } finally {
      setBoostBusy(false);
    }
  }, [boostBusy, applyResponse]);

  const doCrank = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/crank", { method: "POST", cache: "no-store" });
      if (!r.ok) throw new Error("crank failed");
      applyResponse((await r.json()) as CrankResponse);
      setNetErr(false);
      onStackChanged?.();
    } catch {
      setNetErr(true);
    } finally {
      setBusy(false);
    }
  }, [busy, applyResponse, onStackChanged]);

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

  const activePhase = view?.phase === "winding" || view?.phase === "ready";
  useEffect(() => {
    if (!activePhase) return;
    const id = setInterval(() => setNow(Date.now()), reduced.current ? 1000 : 250);
    return () => clearInterval(id);
  }, [activePhase]);

  const d = useMemo(() => {
    if (!view) return null;
    const elapsed = Math.max(0, now - recvAt) / 1000;
    let stack = view.stack;
    let endsIn = view.phaseEndsInMs;
    if (view.phase === "winding") {
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

  const coinCount = useMemo(() => {
    if (!view || d == null || d.stack <= 0) return 0;
    const cap = COIN_CAP[view.tierIndex];
    const span = (view.nextTierAt ?? d.stack * 2) - view.tierAt;
    const prog = span > 0 ? Math.min(1, (d.stack - view.tierAt) / span) : 1;
    return Math.max(4, Math.round(cap * prog));
  }, [view, d]);

  const skinLevel = rankLevel(rank, players);
  const goal = nextSkin(skinLevel, players);
  const phase = view?.phase ?? "off";
  const machineClass =
    "machine" + (phase === "winding" ? " winding" : "") + (phase === "stall" ? " stalled" : "");

  let statusClass = "status";
  let statusText = "loading…";
  let crankLabel = "CRANK";
  let crankHint = "start the machine";
  let crankDisabled = busy;
  let crankDanger = false;

  if (view) {
    if (phase === "off") {
      statusText = "machine is off";
    } else if (phase === "winding") {
      statusText = `STACKING · ${fmtLeft(d?.endsIn ?? 0)} left`;
      crankLabel = "WINDING…";
      crankHint = "already winding — come back at 0";
      crankDisabled = true;
    } else if (phase === "ready") {
      statusClass += " ready";
      statusText = `CRANK NOW · ${fmtLeft(d?.endsIn ?? 0)} before the raider`;
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

      {netErr && (
        <div className="netbanner" role="alert">
          <span>
            Can&apos;t reach the machine. Your stack is safe on the server — nothing is
            lost.
          </span>
          <button className="btn btn-ghost sm" onClick={refetch}>
            RETRY
          </button>
        </div>
      )}

      <div className="game-grid" aria-busy={!view}>
        <div className="game-main">
          <div className="tierbar">
            <div className="tier-name">
              <span className="n">
                TIER {String((view?.tierIndex ?? 0) + 1).padStart(2, "0")}
              </span>
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
              <div className="vault">
                <SafeSprite
                  level={skinLevel}
                  spinning={phase === "winding"}
                  stalled={phase === "stall"}
                />
                <div className="skin-tag">
                  <b>{RANK_SKINS[skinLevel].label}</b>
                  <span>{RANK_SKINS[skinLevel].hint}</span>
                  {goal && (
                    <span className="skin-next">
                      {goal.unlocked
                        ? `next: ${goal.label}`
                        : `${goal.label} at ${goal.unlockAt + 1}+ stackers`}
                    </span>
                  )}
                </div>
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

            <div className="gauge-wrap">
              <svg viewBox="0 0 200 24" aria-hidden="true">
                <rect x="2" y="14" width="196" height="6" fill="#0e0904" />
                <rect
                  x="2"
                  y="14"
                  width={Math.min(1, ((view?.multiplier ?? 1) - 1) / 14) * 196}
                  height="6"
                  fill="var(--neon)"
                />
                <rect
                  x={2 + Math.min(1, ((view?.multiplier ?? 1) - 1) / 14) * 196 - 2}
                  y="9"
                  width="5"
                  height="12"
                  fill="var(--neon-hi)"
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
        </div>

        <aside className="game-side">
          <div className="card boostcard">
            <h3 className="card-h neon">HOLDER BOOST</h3>
            {wallet ? (
              <>
                <p className="boost-state">
                  <span className={"bpill" + (view?.boost ? " on" : "")}>
                    {view?.boost ? "×5 ACTIVE" : "not holding $VLTR"}
                  </span>
                  <button
                    className="btn btn-ghost sm"
                    disabled={boostBusy}
                    onClick={recheckBoost}
                    title="re-read your $VLTR balance on-chain"
                  >
                    {boostBusy ? "…" : "RE-CHECK"}
                  </button>
                </p>
                {boostStale && (
                  <p className="muted-note warn">
                    Couldn&apos;t reach the network just now — showing the last confirmed
                    result. Your boost was not changed.
                  </p>
                )}
                <p className="muted-note">
                  Wallet linked. We read your $VLTR balance on-chain — nothing is deposited
                  or locked. The boost is locked in when you crank, so hold before you wind.
                </p>
              </>
            ) : (
              <>
                <p className="muted-note">
                  Hold <b>$VLTR</b> to stack <b>×5</b> faster — that&apos;s how you reach the
                  top 10 that splits the weekly pool. Connect a wallet to link your account:
                  one signature, no gas, no custody.
                </p>
                <div className="boost-connect">
                  <ConnectButton wallet={wallet} onChanged={refetch} />
                </div>
              </>
            )}
          </div>

          {wallet && (
            <ProfileEditor
              nickname={nickname}
              hideWallet={hideWallet}
              onSaved={refetch}
            />
          )}

          <div className="card rules">
            <h3 className="card-h">THE RULES</h3>
            <ul className="rules-list">
              <li>One cycle is 24h — crank once a day.</li>
              <li>Crank inside the window → streak +1, multiplier up.</li>
              <li>Miss it → raider skims your stack, streak resets.</li>
              <li>Top 10 of the weekly board split the fee pool.</li>
              <li>Climb the board to unlock better safe skins.</li>
              <li>Play free — hold $VLTR for the ×5 that gets you into the top 10.</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

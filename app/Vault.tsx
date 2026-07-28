"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HolderTierView, PublicView } from "@/lib/game";
import ConnectButton from "./components/ConnectButton";
import ProfileEditor from "./components/ProfileEditor";
import SafeSprite from "./components/SafeSprite";
import TelegramLink from "./components/TelegramLink";
import {
  RANK_SKINS,
  rankLevel,
  nextSkin,
  STREAK_BADGES,
  earnedStreakBadges,
  nextStreakBadge,
} from "@/lib/skins";

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
/** Ответ /api/boost/refresh: к стейту добавляет свой баланс и цену следующей ступени. */
interface BoostResponse extends StateResponse {
  stale?: boolean;
  holderBalance?: string | null;
  toNextTier?: string | null;
}

/**
 * Стек с достаточной точностью, чтобы цифра ЖИЛА.
 *
 * `Math.floor` на прод-ставке (0.012/с при стрике 1) не менялся 83 секунды: игрок нажимал
 * CRANK, видел неподвижный 0 и делал вывод, что игра сломана. Дробные разряды показываем,
 * пока стек мал, и убираем, когда цифры и так растут заметно.
 */
function fmt(n: number): string {
  const digits = n < 100 ? 2 : n < 10_000 ? 1 : 0;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Круглые числа: пороги тиров и прочие константы — без дробной части. */
function fmtWhole(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** Множитель без хвоста из нулей: ×2, ×2.75. */
function fmtMult(m: number): string {
  return "×" + String(Math.round(m * 100) / 100);
}

/** Доля эмиссии: очень малые значения не должны схлопываться в «0%». */
function fmtPct(p: number): string {
  if (p <= 0) return "0%";
  if (p < 0.001) return "<0.001%";
  return `${Number(p.toPrecision(3))}%`;
}

/** Количество токенов из строки в единицах токена — только для показа. */
function fmtTokens(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return n.toLocaleString("en-US", { maximumFractionDigits: n < 1 ? 4 : 0 });
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
  ladder,
  onStackChanged,
}: {
  /** Место в недельном борде — определяет скин сейфа. */
  rank?: number | null;
  /** Размер комьюнити — от него зависит, какие скины вообще открыты. */
  players?: number;
  /** Лестница холдерского буста (статична, приходит с сервера пропсом). */
  ladder: HolderTierView[];
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
  /** Свой баланс $VLTR и сколько докупить до следующей ступени (из /api/boost/refresh). */
  const [holderBalance, setHolderBalance] = useState<string | null>(null);
  const [toNextTier, setToNextTier] = useState<string | null>(null);
  const [netErr, setNetErr] = useState(false);
  /**
   * Сколько реально забрал рейдер — держим значение из ответа сервера, пока машина
   * стоит в `stall`. Сам факт рейда сервер отдаёт ОДИН раз, ровно в том ответе, где
   * settle его применил (см. lib/game.ts) — следующий поллинг снова видит `raid: null`,
   * хотя фаза всё ещё "stall". Без этого стейта экран после первого же опроса забывал
   * бы, что именно потерялось, и надпись про рейд превращалась в голословную.
   */
  const [lastLoss, setLastLoss] = useState<number | null>(null);
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
    if (data.raid && data.raid.lost > 0) {
      triggerFlash();
      setLastLoss(data.raid.lost);
    }
    // Машина больше не стоит — рестарт (кранк) или ещё не рейдилась вовсе:
    // прошлая потеря больше не относится к текущему циклу, сообщать о ней незачем.
    if (data.view.phase !== "stall") setLastLoss(null);
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
      const d = (await r.json()) as BoostResponse;
      applyResponse(d);
      setBoostStale(Boolean(d.stale));
      setHolderBalance(d.holderBalance ?? null);
      setToNextTier(d.toNextTier ?? null);
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

  // Какие метки за стрик уже заслужены — считает чистая логика (lib/skins.ts), покрытая
  // тестами; Set нужен только чтобы не гонять фильтр по списку на каждую строку рендера.
  const earnedSet = new Set(earnedStreakBadges(view?.streak ?? 0).map((b) => b.streak));

  let statusClass = "status";
  // Метка фазы — короткое слово, читаемое за долю секунды, отдельно от деталей ниже.
  // Раньше вся эта информация была одной строкой текста; на живом проде это оказалось
  // недостаточно заметно — по экрану не было видно, что происходит с машиной прямо сейчас.
  let phaseLabel = "…";
  let phaseDetail = "loading machine state…";
  let lossNote: string | null = null;
  let crankLabel = "CRANK";
  let crankHint = "start the machine";
  let crankDisabled = busy;
  let crankDanger = false;

  if (view) {
    if (phase === "off") {
      phaseLabel = "OFF";
      phaseDetail = "crank to start stacking";
    } else if (phase === "winding") {
      phaseLabel = "WINDING";
      phaseDetail = `window opens in ${fmtLeft(d?.endsIn ?? 0)}`;
      crankLabel = "WINDING…";
      crankHint = "already winding — come back at 0";
      crankDisabled = true;
    } else if (phase === "ready") {
      statusClass += " ready";
      phaseLabel = "WINDOW OPEN";
      phaseDetail = `raider in ${fmtLeft(d?.endsIn ?? 0)} — crank now`;
      crankHint = "+1 streak · multiplier up";
      // Раньше было видно только «сколько времени», не «что теряю». raidPreview.amount
      // точен именно в ready: за grace стек не капает, поэтому он не успевает устареть.
      lossNote =
        view.raidPreview.amount > 0
          ? `miss it → lose ~${fmt(view.raidPreview.amount)} stack (${Math.round(view.raidPreview.pct)}%) and the streak`
          : `miss it → lose the streak`;
    } else {
      statusClass += " stall";
      phaseLabel = "RAIDED";
      phaseDetail = "machine stalled — streak reset to 0";
      crankLabel = "RESTART";
      crankHint = "streak resets to 1";
      crankDanger = true;
      lossNote =
        lastLoss != null
          ? `raider took ${fmt(lastLoss)} stack while you were away`
          : "stack was skimmed while you were away";
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
                  <b>{fmtWhole(view.nextTierAt ?? 0)}</b> stack
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
                  // Текст зависит от ФАЗЫ, а не от стека: на прод-ставке первые монеты
                  // появляются не сразу, и «machine is off» во время завода просто врало.
                  <div className="empty">
                    {phase === "winding" ? (
                      <>
                        winding up —<br />
                        first coins on the way
                      </>
                    ) : (
                      <>
                        machine is off —<br />
                        crank to start stacking
                      </>
                    )}
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

            {/* Метки за стрик — вторая, независимая от ранга в борде ось косметики
                (lib/skins.ts). В отличие от скинов сейфа она не гейтится размером
                комьюнити: стрик — личная метрика, достижимая с первого дня кем угодно. */}
            <ul className="streakbadges" aria-label="streak badges">
              {STREAK_BADGES.map((b) => {
                // Порог сравнивает lib/skins.ts, а не этот файл: иначе «заслужено» жило бы
                // в двух местах и однажды разошлось бы с тестами на чистой логике.
                const earned = earnedSet.has(b.streak);
                return (
                  <li
                    key={b.streak}
                    className={"sbadge" + (earned ? " earned" : "") + (b.founding ? " founding" : "")}
                    title={`${b.hint} (streak ${b.streak}+)`}
                  >
                    {b.label}
                  </li>
                );
              })}
            </ul>
            {(() => {
              const goalBadge = nextStreakBadge(view?.streak ?? 0);
              return goalBadge ? (
                <p className="streak-next">
                  next: <b>{goalBadge.label}</b> at streak {goalBadge.streak}
                </p>
              ) : null;
            })()}

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
              <span className="phase-pill">{phaseLabel}</span> · {phaseDetail}
              {lossNote && <div className="loss-note">{lossNote}</div>}
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
                    {view
                      ? view.boost
                        ? `${fmtMult(view.holder.mult)} ${view.holder.name}`
                        : "no bag — ×1"
                      : "…"}
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

                {/* Лестница: видно, где ты стоишь и что даёт следующая ступень. Именно этого
                    не давал прежний бинарный ×5 — купив порог, докупать было незачем. */}
                <ul className="ladder">
                  {ladder.map((t) => {
                    const at = view?.holder.level === t.level;
                    const done = (view?.holder.level ?? 0) > t.level;
                    return (
                      <li
                        key={t.level}
                        className={"lrow" + (at ? " at" : "") + (done ? " done" : "")}
                        aria-current={at ? "step" : undefined}
                      >
                        <span className="lname">{t.name}</span>
                        <span className="lneed">
                          {t.level === 0 ? "no bag" : `${fmtPct(t.sharePct)} of supply`}
                        </span>
                        <span className="lmult">{fmtMult(t.mult)}</span>
                      </li>
                    );
                  })}
                </ul>

                {view && (
                  <p className="boost-next">
                    {view.nextHolder ? (
                      <>
                        Your share: <b>{fmtPct(view.holderSharePct)}</b> of supply.{" "}
                        {fmtTokens(toNextTier) ? (
                          <>
                            <b>+{fmtTokens(toNextTier)} $VLTR</b> puts you on{" "}
                            {view.nextHolder.name} ({fmtMult(view.nextHolder.mult)}).
                          </>
                        ) : (
                          <>
                            {view.nextHolder.name} starts at{" "}
                            {fmtPct(view.nextHolder.sharePct)} of supply and stacks{" "}
                            {fmtMult(view.nextHolder.mult)}.
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        Top of the ladder — <b>{fmtMult(view.holder.mult)}</b>, the fastest
                        the machine goes. Holding more won&apos;t stack faster.
                      </>
                    )}
                  </p>
                )}

                {boostStale && (
                  <p className="muted-note warn">
                    Couldn&apos;t reach the network just now — showing the last confirmed
                    result. Your boost was not changed.
                  </p>
                )}
                <p className="muted-note">
                  {fmtTokens(holderBalance) && <>You hold {fmtTokens(holderBalance)} $VLTR. </>}
                  Your step is your share of the total supply, so it moves as the token
                  does — and it is re-checked every time you crank. We only read a public
                  balance on-chain: nothing is deposited, locked or transferred.
                </p>
              </>
            ) : (
              <>
                <p className="muted-note">
                  The bigger your share of $VLTR, the higher your step on the ladder — from{" "}
                  <b>{fmtMult(ladder[1]?.mult ?? 1.5)}</b> up to{" "}
                  <b>{fmtMult(ladder[ladder.length - 1]?.mult ?? 5)}</b>. That speed is how
                  players reach the top 10 that splits the weekly pool. Connect a wallet to
                  link your account: one signature, no gas, no custody.
                </p>
                <ul className="ladder">
                  {ladder.slice(1).map((t) => (
                    <li key={t.level} className="lrow">
                      <span className="lname">{t.name}</span>
                      <span className="lneed">{fmtPct(t.sharePct)} of supply</span>
                      <span className="lmult">{fmtMult(t.mult)}</span>
                    </li>
                  ))}
                </ul>
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

          {/* Работает и без кошелька: анонимные сессии — 30 игроков из 34, и именно та
              аудитория, которую напоминания должны удержать в первую очередь. */}
          <TelegramLink />

          <div className="card rules">
            <h3 className="card-h">THE RULES</h3>
            <ul className="rules-list">
              <li>One cycle is 24h — crank once a day.</li>
              <li>Crank inside the window → streak +1, multiplier up.</li>
              <li>Miss it → raider skims your stack, streak resets.</li>
              <li>Top 10 of the weekly board split the fee pool.</li>
              <li>Climb the board to unlock better safe skins.</li>
              <li>Play free — your $VLTR share sets your step, up to ×5.</li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}

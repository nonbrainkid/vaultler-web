"use client";

import { useEffect, useState } from "react";
import SafeSprite from "./SafeSprite";
import { RANK_SKINS, isSkinUnlocked } from "@/lib/skins";

/**
 * Витрина скинов. Закрытые показываем силуэтом с условием открытия —
 * так видно, что потолок едет вверх вместе с комьюнити, и есть куда расти.
 */
export default function SkinShowcase() {
  // null = ещё не знаем размер комьюнити. Не гадаем: пока не загрузилось,
  // не показываем ни замки, ни открытые скины — иначе мигнёт неверным состоянием.
  const [players, setPlayers] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/leaderboard", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setPlayers(d?.players ?? 0))
      .catch(() => alive && setPlayers(0));
    return () => {
      alive = false;
    };
  }, []);

  const known = players !== null;

  return (
    <div className="card skins">
      <h3 className="card-h neon">YOUR SAFE SHOWS YOUR RANK</h3>
      <p className="skins-lead">
        Everyone starts with a dented tin box. Climb the weekly board and the machine
        upgrades itself. No purchase unlocks these — only rank does.
      </p>
      <p className="skins-rule">
        A <b>TOP N</b> skin only switches on once there are more than <b>N</b> stackers —
        otherwise everyone would have it and it would mean nothing. The ceiling rises with
        the community. Right now:{" "}
        <b>{known ? players : "—"}</b> {players === 1 ? "stacker" : "stackers"}.
      </p>

      <div className="skin-grid" aria-busy={!known}>
        {RANK_SKINS.map((s, i) => {
          const locked = known && i > 0 && !isSkinUnlocked(i, players!);
          return (
            <figure
              className={
                "skin-card" + (locked ? " locked" : "") + (known ? "" : " pending")
              }
              key={s.label}
            >
              <SafeSprite level={i} locked={locked || !known} />
              <figcaption>
                <b>{s.label}</b>
                {!known ? (
                  <span>…</span>
                ) : locked ? (
                  <span className="skin-lock">needs {s.unlockAt + 1}+ stackers</span>
                ) : (
                  <span>{s.hint}</span>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>
    </div>
  );
}

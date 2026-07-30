import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { C, CountUp, GLOW, MONO, PIXEL, Reveal, Shell } from "../components/ui";
import { useLayout } from "../layout";
import { FEES, PAYOUT } from "../copy";

const TONE = { neon: C.neon, gold: C.goldHi, zero: C.steelLite };

/**
 * Экономика наград. Две вещи, которые должны остаться в голове: 0% команде и
 * проверяемая формула дележа. Проценты набегают счётчиком, а формула показана целиком —
 * зритель должен уметь пересчитать свою долю сам, это требование `docs/roadmap.md`.
 */
export const Pool: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useLayout();

  return (
    <AbsoluteFill>
      <Backdrop tint="gold" />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell style={{ gap: 2 * u }}>
          <Reveal delay={0}>
            <div
              style={{
                fontFamily: PIXEL,
                fontSize: 1.45 * u,
                letterSpacing: 0.16 * u,
                color: C.neon,
                textShadow: GLOW.neon,
              }}
            >
              WEEKLY POOL · FUNDED BY TRADING FEES
            </div>
          </Reveal>

          <Reveal delay={5}>
            <h2
              style={{
                fontFamily: PIXEL,
                fontSize: (vertical ? 3.8 : 4.6) * u,
                lineHeight: 1.28,
                margin: 0,
                color: C.bone,
                textShadow: `${0.45 * u}px ${0.45 * u}px 0 ${C.woodDarker}`,
              }}
            >
              HOW THE<br />FEES SPLIT
            </h2>
          </Reveal>

          <div
            style={{
              display: "flex",
              flexDirection: vertical ? "column" : "row",
              gap: 1.6 * u,
              marginTop: 0.6 * u,
            }}
          >
            {FEES.map((f, i) => (
              <Reveal
                key={f.label}
                delay={14 + i * 8}
                style={{
                  flex: 1,
                  border: `${0.35 * u}px solid ${C.woodDarker}`,
                  background: "rgba(0,0,0,0.4)",
                  padding: `${1.4 * u}px ${1.4 * u}px`,
                  display: "flex",
                  flexDirection: vertical ? "row" : "column",
                  alignItems: vertical ? "center" : "flex-start",
                  gap: vertical ? 1.4 * u : 0.4 * u,
                }}
              >
                <CountUp
                  to={f.pct}
                  delay={16 + i * 8}
                  duration={18}
                  suffix="%"
                  style={{
                    fontFamily: PIXEL,
                    fontSize: (vertical ? 4 : 4.6) * u,
                    color: TONE[f.tone],
                    textShadow: f.tone === "gold" ? GLOW.gold : f.tone === "neon" ? GLOW.neon : "none",
                    minWidth: vertical ? 13 * u : undefined,
                  }}
                />
                <div>
                  <div
                    style={{
                      fontFamily: PIXEL,
                      fontSize: 1.5 * u,
                      color: C.bone,
                      marginBottom: 0.5 * u,
                    }}
                  >
                    {f.label}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 2.2 * u, color: C.muted, lineHeight: 1.1 }}>
                    {f.note}
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Кривая выплат: десять мест, линейный спуск 18.2% → 1.8%.
              Столбики узкие и в рамке — иначе на фоне барханов они читаются как
              случайные пятна, а не как график. */}
          <Reveal
            delay={44}
            style={{
              marginTop: 1 * u,
              border: `${0.35 * u}px solid ${C.woodDarker}`,
              background: "rgba(0,0,0,0.45)",
              padding: `${1.4 * u}px ${1.6 * u}px ${1 * u}px`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                gap: 0.9 * u,
                height: (vertical ? 13 : 14) * u,
              }}
            >
              {Array.from({ length: 10 }, (_, i) => {
                const weight = 10 - i;
                const grow = interpolate(frame - 48 - i * 3, [0, 12], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                });
                const pct = Math.round((weight / 55) * 1000) / 10;
                const edge = i === 0 || i === 9;
                return (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "flex-end",
                      alignItems: "center",
                      gap: 0.4 * u,
                      height: "100%",
                    }}
                  >
                    {/* Проценты подписаны только у краёв: десять чисел подряд в кадре
                        никто не читает, а «18.2 … 1.8» задаёт масштаб целиком. */}
                    <span
                      style={{
                        fontFamily: PIXEL,
                        fontSize: 1.3 * u,
                        color: i === 0 ? C.goldHi : C.neon,
                        opacity: edge ? grow : 0,
                        textShadow: i === 0 ? GLOW.gold : GLOW.neon,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {pct}%
                    </span>
                    <div
                      style={{
                        width: "72%",
                        height: (weight / 10) * (vertical ? 8 : 9) * u * grow,
                        background: i === 0 ? C.goldHi : C.neon2,
                        boxShadow: i === 0 ? GLOW.gold : "none",
                      }}
                    />
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 2 * u,
                        lineHeight: 1,
                        color: i === 0 ? C.goldHi : C.muted,
                      }}
                    >
                      {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </Reveal>

          <Reveal delay={70}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 2.6 * u,
                lineHeight: 1.15,
                color: C.bone,
                margin: 0,
              }}
            >
              Rank 1 takes <b style={{ color: C.goldHi }}>{PAYOUT.first}%</b>, rank 10 takes{" "}
              <b style={{ color: C.neon }}>{PAYOUT.last}%</b> — share of rank N is{" "}
              <b style={{ color: C.goldHi, fontFamily: PIXEL, fontSize: 2 * u }}>
                {PAYOUT.formula}
              </b>
              . {PAYOUT.note} No volume, no pool — rewards are never guaranteed.
            </p>
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

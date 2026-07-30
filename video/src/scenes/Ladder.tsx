import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { C, GLOW, MONO, PIXEL, Reveal, Shell } from "../components/ui";
import { useLayout } from "../layout";
import { TICKER, TIERS } from "../copy";

/**
 * Лестница холдерского буста. Ключевая мысль сцены — ступенька зависит от ДОЛИ В
 * ЭМИССИИ, а не от размера бэга в токенах, и верх ограничен ×5. Это же и защита от
 * претензии «купи побольше и владей бордом»: потолок виден прямо в кадре.
 */
/** Самое длинное имя тира — «PROSPECTOR», 10 знаков; +1 знак запаса на кернинг. */
const NAME_COLS = 11;

export const Ladder: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useLayout();
  const NAME_FS = vertical ? 1.35 : 1.5;
  const MULT_FS = vertical ? 1.7 : 2;

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
                color: C.goldHi,
                textShadow: GLOW.gold,
              }}
            >
              {TICKER} · THE ONLY UTILITY
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
              HOLD = A<br />
              HIGHER STEP
            </h2>
          </Reveal>

          <div style={{ display: "grid", gap: 0.8 * u, marginTop: 1 * u }}>
            {TIERS.map((t, i) => {
              const start = 14 + i * 7;
              const grow = interpolate(frame - start, [0, 16], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              const top = i === TIERS.length - 1;
              const color = i === 0 ? C.steelLite : top ? C.goldHi : C.neon;
              return (
                <div
                  key={t.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1 * u,
                    opacity: 0.25 + grow * 0.75,
                  }}
                >
                  {/* Ширина колонки считается от САМОГО ДЛИННОГО имени тира, а не на глаз.
                      В Press Start 2P ширина глифа ровно 1em, поэтому 10 символов
                      «PROSPECTOR» занимают 10 × fontSize — при фиксированных 13u текст
                      вылезал на колонку с долей эмиссии. */}
                  <span
                    style={{
                      fontFamily: PIXEL,
                      fontSize: NAME_FS * u,
                      color,
                      width: NAME_COLS * NAME_FS * u,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      textShadow: top ? GLOW.gold : "none",
                    }}
                  >
                    {t.name}
                  </span>
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 2.4 * u,
                      color: C.muted,
                      width: 9 * u,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {t.share}
                  </span>
                  <div
                    style={{
                      flex: 1,
                      height: 1.9 * u,
                      background: "rgba(0,0,0,0.45)",
                      border: `${0.2 * u}px solid ${C.woodDark}`,
                    }}
                  >
                    <div
                      style={{
                        // Ширина — от множителя: полоса и есть «скорость стака».
                        width: `${(t.mult / 5) * 100 * grow}%`,
                        height: "100%",
                        background: top
                          ? `linear-gradient(90deg, ${C.gold}, ${C.goldHi})`
                          : i === 0
                            ? C.steel
                            : `linear-gradient(90deg, ${C.neonDeep}, ${C.neon})`,
                        boxShadow: top ? GLOW.gold : "none",
                      }}
                    />
                  </div>
                  {/* «×3.75» — 5 знаков, каждый шириной в 1em: колонка не может быть уже. */}
                  <span
                    style={{
                      fontFamily: PIXEL,
                      fontSize: MULT_FS * u,
                      color,
                      width: 5.4 * MULT_FS * u,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      textAlign: "right",
                      textShadow: top ? GLOW.gold : "none",
                    }}
                  >
                    ×{t.mult}
                  </span>
                </div>
              );
            })}
          </div>

          <Reveal delay={62}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 2.6 * u,
                lineHeight: 1.12,
                color: C.bone,
                margin: `${1.2 * u}px 0 0`,
              }}
            >
              Your share of supply, not the size of your bag. No deposit, no lockup, no
              staking contract — the site just reads your balance on-chain and re-checks it
              on every crank.{" "}
              {/* «x5» латиницей: в VT323 нет глифа × (см. комментарий в copy.ts). */}
              <b style={{ color: C.goldHi }}>Speed is capped at x5</b>, so no bag owns the
              board.
            </p>
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

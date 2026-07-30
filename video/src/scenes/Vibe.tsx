import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { C, GLOW, MONO, PIXEL, Reveal, Shell } from "../components/ui";
import { useLayout } from "../layout";
import { VIBE } from "../copy";

/**
 * Позиционирующая сцена: анти-трейдинг / про-стакинг. Красная свеча падает, зелёная
 * лесенка стека растёт — картинка договаривает то, что в тексте сказано лозунгом.
 */
export const Vibe: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useLayout();

  const bars = 12;

  return (
    <AbsoluteFill>
      <Backdrop tint="rust" />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell style={{ gap: 2.6 * u, alignItems: "flex-start" }}>
          <Reveal delay={0}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 3.4 * u,
                lineHeight: 1.1,
                color: C.muted,
                margin: 0,
              }}
            >
              {VIBE.lead}
            </p>
          </Reveal>

          {/* два графика: тонущий трейдер и растущий стакер */}
          <Reveal delay={8}>
            <div style={{ display: "flex", gap: 4 * u, alignItems: "flex-end" }}>
              {[
                { color: C.rustHi, dir: -1 },
                { color: C.neon, dir: 1 },
              ].map((series, si) => (
                <div
                  key={si}
                  style={{ display: "flex", alignItems: "flex-end", gap: 0.5 * u }}
                >
                  {Array.from({ length: bars }, (_, i) => {
                    // Столбики выезжают по очереди — читается как движение во времени.
                    const grow = interpolate(
                      frame - 12 - i * 3,
                      [0, 12],
                      [0, 1],
                      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                    );
                    const t = i / (bars - 1);
                    const shape =
                      series.dir > 0
                        ? 0.18 + t * t * 0.82
                        : 0.95 - t * 0.8 + Math.sin(i * 1.7) * 0.06;
                    const h = Math.max(0.06, shape) * (vertical ? 13 : 16) * u * grow;
                    return (
                      <div
                        key={i}
                        style={{
                          width: 1.1 * u,
                          height: h,
                          background: series.color,
                          opacity: 0.9,
                          boxShadow: `0 0 ${1.2 * u}px ${series.color}66`,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={26} distance={4}>
            <h2
              style={{
                fontFamily: PIXEL,
                fontSize: (vertical ? 4.2 : 5.2) * u,
                lineHeight: 1.32,
                margin: 0,
                color: C.bone,
                textShadow: `${0.45 * u}px ${0.45 * u}px 0 ${C.woodDarker}`,
              }}
            >
              <span style={{ color: C.rustHi, textShadow: GLOW.rust }}>
                {VIBE.punch[0]}
              </span>
              <br />
              <span style={{ color: C.neon, textShadow: GLOW.neon }}>
                {VIBE.punch[1]}
              </span>
            </h2>
          </Reveal>

          <Reveal delay={44}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 3 * u,
                color: C.muted,
                margin: 0,
                lineHeight: 1.1,
              }}
            >
              {VIBE.sub}
            </p>
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

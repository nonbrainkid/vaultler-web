import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SafeSprite } from "../components/SafeSprite";
import { C, GLOW, MONO, PIXEL, Reveal, Shell, useReveal } from "../components/ui";
import { useLayout } from "../layout";
import { OUTRO, SITE, TICKER, X_HANDLE } from "../copy";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useLayout();

  const spin = interpolate(frame, [0, 60], [0, 480], { extrapolateRight: "extend" });
  const in1 = useReveal(2, 120);
  // Медленное мигание CTA: кнопка «жми» должна читаться как активная.
  const blink = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(frame / 7));

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell style={{ alignItems: "center", gap: 2 * u, textAlign: "center" }}>
          <div
            style={{
              position: "relative",
              display: "grid",
              placeItems: "center",
              opacity: in1,
              transform: `scale(${0.85 + in1 * 0.15})`,
            }}
          >
            <div
              style={{
                position: "absolute",
                width: 34 * u,
                height: 34 * u,
                borderRadius: "50%",
                background: `radial-gradient(circle, ${C.gold}30, transparent 62%)`,
              }}
            />
            <SafeSprite level={5} dialAngle={spin} size={(vertical ? 30 : 28) * u} />
          </div>

          <Reveal delay={10}>
            <h2
              style={{
                fontFamily: PIXEL,
                fontSize: (vertical ? 5.4 : 6) * u,
                lineHeight: 1.2,
                margin: 0,
                color: C.bone,
                letterSpacing: 0.03 * u,
                textShadow: `${0.5 * u}px ${0.5 * u}px 0 ${C.woodDarker}`,
              }}
            >
              {OUTRO.title[0]}{" "}
              <span style={{ color: C.goldHi }}>{OUTRO.title[1]}</span>
            </h2>
          </Reveal>

          <Reveal delay={18}>
            <p
              style={{
                fontFamily: MONO,
                fontSize: 3.4 * u,
                margin: 0,
                color: C.neonHi,
                textShadow: GLOW.neon,
              }}
            >
              {OUTRO.tag}
            </p>
          </Reveal>

          <Reveal delay={26} style={{ marginTop: 0.8 * u }}>
            <div
              style={{
                fontFamily: PIXEL,
                fontSize: 2.1 * u,
                color: "#0c1a06",
                background: C.neon,
                border: `${0.45 * u}px solid ${C.woodDarker}`,
                padding: `${1.5 * u}px ${2.4 * u}px`,
                opacity: blink,
                boxShadow: `0 ${0.7 * u}px 0 0 ${C.neonDeep}`,
              }}
            >
              {OUTRO.cta}
            </div>
          </Reveal>

          <Reveal delay={34} style={{ marginTop: 1 * u }}>
            <div
              style={{
                fontFamily: PIXEL,
                fontSize: (vertical ? 2.8 : 3) * u,
                color: C.goldHi,
                textShadow: GLOW.gold,
                letterSpacing: 0.04 * u,
              }}
            >
              {SITE}
            </div>
          </Reveal>

          <Reveal delay={40}>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 2.6 * u,
                color: C.muted,
                display: "flex",
                gap: 2 * u,
                justifyContent: "center",
              }}
            >
              <span>{X_HANDLE}</span>
              <span style={{ color: C.steelDark }}>|</span>
              <span>{TICKER} on Robinhood Chain</span>
            </div>
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SafeSprite } from "../components/SafeSprite";
import { C, GLOW, MONO, PIXEL, Reveal, Shell, useReveal } from "../components/ui";
import { useLayout } from "../layout";
import { HERO } from "../copy";

export const Hero: React.FC = () => {
  const frame = useCurrentFrame();
  const { u, vertical } = useLayout();

  // Диск раскручивается и выходит на ровное вращение — «машину завели».
  const spin = interpolate(frame, [0, 40, 150], [0, 200, 900], {
    extrapolateRight: "extend",
  });
  const safeIn = useReveal(6, 120);
  // Дыхание неонового ядра — тот же приём, что и `.is-spinning` на сайте.
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(frame / 9));

  const safe = (
    <div
      style={{
        position: "relative",
        opacity: safeIn,
        transform: `scale(${0.8 + safeIn * 0.2})`,
        display: "grid",
        placeItems: "center",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: (vertical ? 40 : 44) * u,
          height: (vertical ? 40 : 44) * u,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${C.neon}2e, transparent 62%)`,
          opacity: pulse,
        }}
      />
      <SafeSprite level={4} dialAngle={spin} size={(vertical ? 36 : 40) * u} />
    </div>
  );

  const copy = (
    <div style={{ display: "flex", flexDirection: "column", gap: 1.8 * u }}>
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
          {HERO.eyebrow}
        </div>
      </Reveal>

      <Reveal delay={8} distance={5}>
        <h1
          style={{
            fontFamily: PIXEL,
            fontSize: (vertical ? 7 : 8.4) * u,
            lineHeight: 1.16,
            margin: 0,
            color: C.bone,
            letterSpacing: 0.03 * u,
            textShadow: `${0.6 * u}px ${0.6 * u}px 0 ${C.woodDarker}, 0 0 ${3 * u}px ${C.gold}55`,
          }}
        >
          {HERO.title[0]}
          <br />
          <span style={{ color: C.goldHi }}>{HERO.title[1]}</span>
        </h1>
      </Reveal>

      <Reveal delay={22}>
        <p
          style={{
            fontFamily: MONO,
            fontSize: 4 * u,
            lineHeight: 1.05,
            margin: 0,
            color: C.neonHi,
            textShadow: GLOW.neon,
          }}
        >
          {HERO.tag}
        </p>
      </Reveal>
    </div>
  );

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell
          style={{
            flexDirection: vertical ? "column" : "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 3 * u,
          }}
        >
          {vertical ? (
            <>
              {safe}
              {copy}
            </>
          ) : (
            <>
              {copy}
              {safe}
            </>
          )}
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

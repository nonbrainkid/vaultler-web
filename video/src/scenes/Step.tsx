import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { SafeSprite } from "../components/SafeSprite";
import { C, GLOW, MONO, PIXEL, Reveal, Shell, useReveal } from "../components/ui";
import { useLayout } from "../layout";
import { STEPS } from "../copy";

const ACCENTS = { neon: C.neon, gold: C.goldHi, rust: C.rustHi };

/**
 * Иллюстрация шага. Каждая — про ОДНО событие петли, потому что зритель успевает
 * прочитать текст ровно один раз: 01 завод, 02 стрик и множитель, 03 ским рейдера,
 * 04 борд. Цифры в 02/03 совпадают с ядром (`lib/game.ts`): ским 15%, потолок ×5.
 */
const StepArt: React.FC<{ n: string }> = ({ n }) => {
  const frame = useCurrentFrame();
  const { u, vertical } = useLayout();
  const size = (vertical ? 26 : 30) * u;

  if (n === "01") {
    const spin = interpolate(frame, [10, 100], [0, 620], { extrapolateLeft: "clamp" });
    const lever = interpolate(frame, [10, 26, 40], [-38, 34, 0], {
      extrapolateRight: "clamp",
    });
    return (
      // Колонка, а не absolute-подпись поверх спрайта: подпись в PIXEL переносится по
      // словам, и в узком кадре 1:1 вторая строка наезжала на корпус сейфа.
      <div style={{ display: "grid", justifyItems: "center", gap: 1.4 * u }}>
        <div style={{ position: "relative", width: size, height: size }}>
          <SafeSprite level={2} dialAngle={spin} size={size} />
          {/* Рычаг привязан к ПРАВОЙ КРОМКЕ корпуса (в спрайте 32×32 ручка на x=29…30),
              иначе он висит в воздухе отдельной красной палкой. Дёрнули вниз — вернулся:
              «одно нажатие в сутки». */}
          <div
            style={{
              position: "absolute",
              left: size * 0.945,
              top: size * 0.44,
              width: size * 0.035,
              height: size * 0.26,
              background: C.rustHi,
              transformOrigin: "top center",
              transform: `rotate(${lever}deg)`,
              boxShadow: GLOW.rust,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: size * -0.018,
                bottom: size * -0.035,
                width: size * 0.07,
                height: size * 0.07,
                background: C.rust,
                border: `${size * 0.012}px solid ${C.rustHi}`,
              }}
            />
          </div>
        </div>
        <div
          style={{
            fontFamily: PIXEL,
            fontSize: 1.7 * u,
            color: C.neon,
            textShadow: GLOW.neon,
            whiteSpace: "nowrap",
          }}
        >
          + $STACK / 24H
        </div>
      </div>
    );
  }

  if (n === "02") {
    const lit = Math.floor(
      interpolate(frame - 14, [0, 60], [0, 7], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    );
    // Множитель считается ИЗ числа зажжённых дней той же формулой, что и в ядре
    // (`lib/game.ts`: 1 + streak × STREAK_STEP, STREAK_STEP = 0.2). Иначе цифра в кадре
    // разошлась бы с игрой — а ролик, обещающий множитель больше настоящего, это
    // ровно то, за что потом спрашивают в комментариях.
    const mult = 1 + lit * 0.2;
    return (
      <div style={{ display: "grid", gap: 2 * u, placeItems: "center" }}>
        <div style={{ display: "flex", gap: 0.8 * u }}>
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              style={{
                width: 2.6 * u,
                height: 2.6 * u,
                border: `${0.3 * u}px solid ${i < lit ? C.goldHi : C.steelDark}`,
                background: i < lit ? C.gold : "transparent",
                boxShadow: i < lit ? GLOW.gold : "none",
              }}
            />
          ))}
        </div>
        <div
          style={{
            fontFamily: PIXEL,
            fontSize: 5.5 * u,
            color: C.goldHi,
            textShadow: GLOW.gold,
          }}
        >
          ×{mult.toFixed(2)}
        </div>
        <div style={{ fontFamily: MONO, fontSize: 2.4 * u, color: C.muted }}>
          {lit} DAYS IN A ROW · +0.2 EACH
        </div>
      </div>
    );
  }

  if (n === "03") {
    // 15% — GAME.SKIM. Полоса краснеет и «откусывается» ровно на эту долю.
    const skim = interpolate(frame - 24, [0, 30], [0, 0.15], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    const shake = frame > 22 && frame < 50 ? Math.sin(frame * 2.2) * 0.5 * u : 0;
    return (
      <div style={{ display: "grid", gap: 2 * u, placeItems: "center" }}>
        <div style={{ transform: `translateX(${shake}px)` }}>
          <SafeSprite level={0} dialAngle={0} size={size * 0.8} />
        </div>
        <div
          style={{
            width: (vertical ? 30 : 34) * u,
            height: 2.6 * u,
            background: C.steelDark,
            border: `${0.3 * u}px solid ${C.woodDarker}`,
            display: "flex",
          }}
        >
          <div style={{ flex: 1 - skim, background: C.neon2 }} />
          <div
            style={{
              flex: skim,
              background: C.rust,
              boxShadow: GLOW.rust,
            }}
          />
        </div>
        <div
          style={{
            fontFamily: PIXEL,
            fontSize: 2.2 * u,
            color: C.rustHi,
            textShadow: GLOW.rust,
          }}
        >
          RAIDER TAKES 15% · STREAK → 0
        </div>
      </div>
    );
  }

  // 04 — недельный борд: десять мест, первое золотое.
  const rows = 10;
  return (
    <div style={{ display: "grid", gap: 0.7 * u, width: (vertical ? 34 : 36) * u }}>
      {Array.from({ length: rows }, (_, i) => {
        const grow = interpolate(frame - 12 - i * 2.5, [0, 14], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const w = (1 - i * 0.075) * 100 * grow;
        const gold = i === 0;
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 0.8 * u }}>
            <span
              style={{
                fontFamily: PIXEL,
                fontSize: 1.3 * u,
                color: gold ? C.goldHi : C.steelLite,
                width: 2.6 * u,
              }}
            >
              {i + 1}
            </span>
            <div
              style={{
                height: 1.7 * u,
                width: `${w}%`,
                background: gold ? C.goldHi : C.neon2,
                boxShadow: gold ? GLOW.gold : "none",
              }}
            />
          </div>
        );
      })}
      <div
        style={{
          fontFamily: PIXEL,
          fontSize: 1.25 * u,
          color: C.goldHi,
          marginTop: 0.8 * u,
          textShadow: GLOW.gold,
          whiteSpace: "nowrap",
        }}
      >
        TOP 10 SPLIT THE POOL
      </div>
    </div>
  );
};

export const Step: React.FC<{ index: number }> = ({ index }) => {
  const { u, vertical } = useLayout();
  const s = STEPS[index];
  const accent = ACCENTS[s.accent];
  const p = useReveal(4, 140);

  const copy = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1.4 * u,
        flex: vertical ? "none" : 1,
      }}
    >
      {/* счётчик шагов: зритель всегда знает, сколько ещё осталось */}
      <div style={{ display: "flex", gap: 0.8 * u, alignItems: "center" }}>
        {STEPS.map((_, i) => (
          <div
            key={i}
            style={{
              width: (i === index ? 4 : 1.6) * u,
              height: 0.7 * u,
              background: i === index ? accent : C.steelDark,
              boxShadow: i === index ? `0 0 ${1.2 * u}px ${accent}88` : "none",
            }}
          />
        ))}
      </div>

      <div
        style={{
          fontFamily: PIXEL,
          fontSize: (vertical ? 7 : 8) * u,
          color: accent,
          lineHeight: 1,
          opacity: 0.28,
          transform: `translateX(${(1 - p) * -4 * u}px)`,
        }}
      >
        {s.n}
      </div>

      <Reveal delay={8}>
        <h2
          style={{
            fontFamily: PIXEL,
            fontSize: (vertical ? 3.6 : 4.4) * u,
            lineHeight: 1.25,
            margin: 0,
            color: C.bone,
            textShadow: `${0.45 * u}px ${0.45 * u}px 0 ${C.woodDarker}`,
          }}
        >
          {s.t}
        </h2>
      </Reveal>

      <Reveal delay={16}>
        <p
          style={{
            fontFamily: MONO,
            fontSize: (vertical ? 3 : 2.9) * u,
            lineHeight: 1.12,
            margin: 0,
            color: C.bone,
            maxWidth: 46 * u,
          }}
        >
          {s.d}
        </p>
      </Reveal>
    </div>
  );

  return (
    <AbsoluteFill>
      <Backdrop tint={s.accent === "rust" ? "rust" : s.accent === "gold" ? "gold" : "neon"} />
      <AbsoluteFill style={{ justifyContent: "center" }}>
        <Shell
          style={{
            flexDirection: vertical ? "column" : "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: vertical ? 4 * u : 3 * u,
          }}
        >
          {copy}
          <Reveal delay={12} style={{ display: "grid", placeItems: "center" }}>
            <StepArt n={s.n} />
          </Reveal>
        </Shell>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

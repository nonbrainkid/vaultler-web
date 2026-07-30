/**
 * Фон всех сцен: пустынный закат + неоновая подсветка слева, как у `body` на сайте,
 * плюс медленно плывущие звёзды и барханы.
 *
 * Звёзды разложены по детерминированной псевдослучайной последовательности, а не
 * `Math.random()`: рендер идёт множеством параллельных воркеров, и настоящий random
 * дал бы разные небеса на соседних кадрах.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { useLayout } from "../layout";

/** Детерминированный «шум» из целого — mulberry-подобный хеш. */
const rnd = (seed: number) => {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
};

const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: rnd(i + 1) * 100,
  y: rnd(i + 40) * 55,
  s: 0.2 + rnd(i + 90) * 0.35,
  tw: rnd(i + 130),
}));

export const Backdrop: React.FC<{ tint?: "neon" | "gold" | "rust" }> = ({
  tint = "neon",
}) => {
  const frame = useCurrentFrame();
  const { u, width, height } = useLayout();

  const tintColor =
    tint === "gold" ? "245, 184, 37" : tint === "rust" ? "176, 58, 36" : "140, 255, 90";

  return (
    <AbsoluteFill style={{ backgroundColor: C.void, overflow: "hidden" }}>
      {/* закат за горизонтом */}
      <AbsoluteFill
        style={{
          backgroundImage: [
            `radial-gradient(${width * 0.7}px ${height * 0.42}px at 50% -8%, rgba(245,197,24,0.24), transparent 70%)`,
            `radial-gradient(${width * 0.45}px ${height * 0.3}px at 10% 12%, rgba(${tintColor},0.12), transparent 70%)`,
          ].join(","),
        }}
      />

      {STARS.map((st, i) => {
        // Мерцание: у каждой звезды своя фаза, иначе всё небо моргает синхронно.
        const a = 0.25 + 0.45 * (0.5 + 0.5 * Math.sin(frame / 14 + st.tw * 6.28));
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${st.x}%`,
              top: `${st.y}%`,
              width: st.s * u,
              height: st.s * u,
              background: "#fff0c8",
              opacity: a,
            }}
          />
        );
      })}

      {/* дальние меса — три слоя, ползут с разной скоростью (параллакс) */}
      {[
        { h: 0.3, c: C.mesaDeep, speed: 0.12, o: 0.5 },
        { h: 0.22, c: C.woodDark, speed: 0.26, o: 0.75 },
        { h: 0.14, c: C.woodDarker, speed: 0.5, o: 1 },
      ].map((layer, li) => (
        <svg
          key={li}
          width={width * 2}
          height={height}
          style={{
            position: "absolute",
            left: -((frame * layer.speed) % width),
            bottom: 0,
            opacity: layer.o,
          }}
        >
          {Array.from({ length: 24 }, (_, i) => {
            const w = width * 0.18;
            // Высота барханов считается от КОРОТКОЙ стороны кадра, а не от height:
            // в вертикали 9:16 доля от высоты давала горы на треть экрана, и они
            // забивали текст.
            const h = 55 * u * layer.h * (0.5 + rnd(i + li * 31) * 0.9);
            return (
              <rect
                key={i}
                x={i * w * 0.72}
                y={height - h}
                width={w}
                height={h}
                fill={layer.c}
              />
            );
          })}
        </svg>
      ))}

      {/* сканлайны — «CRT»-фактура поверх всего */}
      <AbsoluteFill
        style={{
          backgroundImage: `repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)`,
          opacity: 0.5,
          mixBlendMode: "multiply",
        }}
      />
      {/* виньетка — уводит края в темноту, держит взгляд в центре */}
      <AbsoluteFill
        style={{
          boxShadow: `inset 0 0 ${18 * u}px ${6 * u}px rgba(0,0,0,0.75)`,
        }}
      />
    </AbsoluteFill>
  );
};

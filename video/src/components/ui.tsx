/**
 * Мелкие переиспользуемые куски вёрстки ролика: заголовок секции, деревянная карточка,
 * «неоновая» строка, появление с задержкой.
 *
 * Всё анимируется от `frame`, а не CSS-переходами: рендер идёт по кадрам вразнобой на
 * нескольких воркерах, и CSS-анимация в этом режиме недетерминирована.
 */
import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, GLOW, woodFrame } from "../theme";
import { useLayout } from "../layout";
import { PIXEL, MONO } from "../fonts";

/** Прогресс появления 0→1 с задержкой в кадрах. */
export const useReveal = (delay = 0, damping = 200) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - delay, fps, config: { damping, mass: 0.6 } });
};

/** Обёртка «выехало снизу и проявилось». */
export const Reveal: React.FC<{
  delay?: number;
  distance?: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ delay = 0, distance = 3, children, style }) => {
  const p = useReveal(delay);
  const { u } = useLayout();
  return (
    <div
      style={{
        opacity: p,
        transform: `translateY(${(1 - p) * distance * u}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = C.neon,
}) => {
  const { u } = useLayout();
  return (
    <div
      style={{
        fontFamily: PIXEL,
        fontSize: 1.5 * u,
        letterSpacing: 0.18 * u,
        color,
        textShadow: GLOW.neon,
      }}
    >
      {children}
    </div>
  );
};

export const SectionTitle: React.FC<{
  children: React.ReactNode;
  color?: string;
  delay?: number;
}> = ({ children, color = C.bone, delay = 0 }) => {
  const { u } = useLayout();
  return (
    <Reveal delay={delay}>
      <h2
        style={{
          fontFamily: PIXEL,
          fontSize: 3.6 * u,
          lineHeight: 1.35,
          color,
          margin: 0,
          letterSpacing: 0.04 * u,
          textShadow: `${0.35 * u}px ${0.35 * u}px 0 ${C.woodDarker}`,
        }}
      >
        {children}
      </h2>
    </Reveal>
  );
};

export const Lead: React.FC<{ children: React.ReactNode; delay?: number }> = ({
  children,
  delay = 0,
}) => {
  const { u } = useLayout();
  return (
    <Reveal delay={delay}>
      <p
        style={{
          fontFamily: MONO,
          fontSize: 3.1 * u,
          lineHeight: 1.15,
          color: C.muted,
          margin: 0,
        }}
      >
        {children}
      </p>
    </Reveal>
  );
};

/** Деревянная карточка — визуальный аналог `.card` на сайте. */
export const Card: React.FC<{
  children: React.ReactNode;
  delay?: number;
  accent?: string;
  style?: React.CSSProperties;
}> = ({ children, delay = 0, accent, style }) => {
  const { u } = useLayout();
  const p = useReveal(delay);
  return (
    <div
      style={{
        ...woodFrame(u),
        padding: `${2.4 * u}px ${2.2 * u}px`,
        opacity: p,
        transform: `translateY(${(1 - p) * 3 * u}px)`,
        boxShadow: accent
          ? `inset 0 ${0.5 * u}px 0 0 ${accent}, 0 ${0.8 * u}px 0 0 rgba(0,0,0,0.5)`
          : `0 ${0.8 * u}px 0 0 rgba(0,0,0,0.5)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export const CardHead: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = C.neon,
}) => {
  const { u } = useLayout();
  return (
    <h3
      style={{
        fontFamily: PIXEL,
        fontSize: 1.7 * u,
        lineHeight: 1.5,
        color,
        margin: `0 0 ${1.4 * u}px`,
        letterSpacing: 0.05 * u,
        textShadow: color === C.gold || color === C.goldHi ? GLOW.gold : GLOW.neon,
      }}
    >
      {children}
    </h3>
  );
};

export const Body: React.FC<{ children: React.ReactNode; size?: number }> = ({
  children,
  size = 2.5,
}) => {
  const { u } = useLayout();
  return (
    <p
      style={{
        fontFamily: MONO,
        fontSize: size * u,
        lineHeight: 1.12,
        color: C.bone,
        margin: 0,
      }}
    >
      {children}
    </p>
  );
};

/**
 * Счётчик, набегающий до значения. Используется для процентов и множителей: цифра,
 * которая «докручивается», читается как результат, а не как статичная надпись.
 */
export const CountUp: React.FC<{
  to: number;
  delay?: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  style?: React.CSSProperties;
}> = ({ to, delay = 0, duration = 25, decimals = 0, prefix = "", suffix = "", style }) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame - delay, [0, duration], [0, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <span style={style}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </span>
  );
};

/** Горизонтальная колонка контента — аналог `.shell`. */
export const Shell: React.FC<{
  children: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ children, style }) => {
  const { u, shell } = useLayout();
  return (
    <div
      style={{
        width: shell * u,
        maxWidth: "92%",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      {children}
    </div>
  );
};

export { C, GLOW, PIXEL, MONO };

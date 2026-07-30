/**
 * Пиксель-спрайт сейфа 32×32 — порт `app/components/SafeSprite.tsx`.
 *
 * Отличия от сайта: анимация диска идёт от кадра Remotion, а не от CSS-анимации.
 * CSS-кейфреймы в рендере не детерминированы (кадр берётся в произвольный момент
 * времени анимации), поэтому вращение считается из `frame` — тогда любой повторный
 * рендер даёт байт-в-байт тот же результат.
 */
import React from "react";

type Key = "." | "K" | "D" | "S" | "L" | "P" | "B" | "N" | "G" | "Y" | "H" | "M";

const W = 32;
const H = 32;

const blank = (): Key[][] => Array.from({ length: H }, () => Array<Key>(W).fill("."));

function roundRect(
  g: Key[][],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  k: Key,
) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
      const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
      if (dx > 0 && dy > 0 && dx * dx + dy * dy > r * r) continue;
      g[y][x] = k;
    }
  }
}

function disc(g: Key[][], cx: number, cy: number, r: number, k: Key) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) g[y][x] = k;
    }
}

function ring(g: Key[][], cx: number, cy: number, r0: number, r1: number, k: Key) {
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d <= r1) g[y][x] = k;
    }
}

function rect(g: Key[][], x0: number, y0: number, x1: number, y1: number, k: Key) {
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) if (y >= 0 && y < H && x >= 0 && x < W) g[y][x] = k;
}

function outline(g: Key[][], k: Key) {
  const src = g.map((r) => r.slice());
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (src[y][x] !== ".") continue;
      const near =
        (y > 0 && src[y - 1][x] !== ".") ||
        (y < H - 1 && src[y + 1][x] !== ".") ||
        (x > 0 && src[y][x - 1] !== ".") ||
        (x < W - 1 && src[y][x + 1] !== ".");
      if (near) g[y][x] = k;
    }
}

const CX = 16;
const CY = 18;

function decorate(g: Key[][], level: number) {
  if (level >= 1) rect(g, 15, 3, 16, 4, "M");
  if (level >= 2) {
    rect(g, 10, 4, 11, 5, "M");
    rect(g, 20, 4, 21, 5, "M");
  }
  if (level >= 3) {
    rect(g, 5, 5, 26, 5, "G");
    rect(g, 5, 5, 5, 5, "Y");
    rect(g, 26, 5, 26, 5, "Y");
  }
  if (level >= 4) {
    rect(g, 6, 3, 7, 5, "G");
    rect(g, 12, 3, 13, 5, "G");
    rect(g, 18, 3, 19, 5, "G");
    rect(g, 24, 3, 25, 5, "G");
    rect(g, 15, 3, 16, 4, "M");
  }
  if (level >= 5) {
    rect(g, 5, 4, 26, 5, "Y");
    (
      [
        [7, 2],
        [11, 1],
        [15, 0],
        [19, 1],
        [23, 2],
      ] as [number, number][]
    ).forEach(([px, py]) => rect(g, px, py, px + 1, 3, "Y"));
    rect(g, 15, 0, 16, 0, "M");
    rect(g, 9, 4, 10, 4, "M");
    rect(g, 21, 4, 22, 4, "M");
  }
}

function buildBody(level: number): Key[][] {
  const g = blank();

  roundRect(g, 3, 6, 28, 30, 3, "S");
  roundRect(g, 3, 6, 28, 8, 3, "L");
  rect(g, 3, 28, 28, 30, "D");
  rect(g, 3, 9, 4, 27, "L");
  rect(g, 27, 9, 28, 27, "D");

  roundRect(g, 7, 10, 24, 28, 2, "P");
  rect(g, 7, 10, 24, 10, "D");
  rect(g, 7, 28, 24, 28, "L");

  (
    [
      [5, 8],
      [25, 8],
      [5, 27],
      [25, 27],
    ] as [number, number][]
  ).forEach(([bx, by]) => {
    rect(g, bx, by, bx + 1, by + 1, "B");
    g[by + 1][bx] = "D";
  });

  rect(g, 1, 12, 3, 15, "D");
  rect(g, 1, 22, 3, 25, "D");
  rect(g, 1, 13, 1, 14, "K");
  rect(g, 1, 23, 1, 24, "K");
  rect(g, 29, 17, 30, 19, "H");
  rect(g, 30, 16, 30, 20, "H");

  disc(g, CX, CY, 6.8, "D");
  disc(g, CX, CY, 6.2, "K");

  rect(g, 12, 26, 19, 27, "D");
  rect(g, 12, 26, 19, 26, "G");
  g[26][12] = "Y";
  g[26][19] = "Y";

  if (level >= 3) {
    rect(g, 8, 12, 8, 12, "M");
    rect(g, 23, 12, 23, 12, "M");
  }
  if (level >= 4) {
    rect(g, 8, 24, 8, 24, "M");
    rect(g, 23, 24, 23, 24, "M");
  }

  decorate(g, level);
  outline(g, "K");
  return g;
}

function buildDial(): Key[][] {
  const g = blank();
  ring(g, CX, CY, 3.4, 6.0, "S");
  ring(g, CX, CY, 5.3, 6.0, "L");
  ring(g, CX, CY, 3.4, 4.0, "D");

  rect(g, CX, CY - 7, CX, CY - 4, "L");
  rect(g, CX, CY + 4, CX, CY + 7, "L");
  rect(g, CX - 7, CY, CX - 4, CY, "L");
  rect(g, CX + 4, CY, CX + 7, CY, "L");
  rect(g, CX - 1, CY - 7, CX + 1, CY - 7, "S");
  rect(g, CX - 1, CY + 7, CX + 1, CY + 7, "S");
  rect(g, CX - 7, CY - 1, CX - 7, CY + 1, "S");
  rect(g, CX + 7, CY - 1, CX + 7, CY + 1, "S");

  disc(g, CX, CY, 2.2, "N");
  return g;
}

interface Run {
  x: number;
  y: number;
  w: number;
  k: Exclude<Key, ".">;
}

function toRuns(g: Key[][]): Run[] {
  const runs: Run[] = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const k = g[y][x];
      if (k === ".") {
        x++;
        continue;
      }
      let w = 1;
      while (x + w < W && g[y][x + w] === k) w++;
      runs.push({ x, y, w, k: k as Exclude<Key, "."> });
      x += w;
    }
  }
  return runs;
}

type Palette = Record<Exclude<Key, ".">, string>;

const PALETTES: Palette[] = [
  { K: "#1b1712", D: "#6f6a5c", S: "#9a9384", L: "#c6bfae", P: "#857e70", B: "#c6bfae", N: "#8cff5a", G: "#c6bfae", Y: "#e4ddcc", H: "#6f6a5c", M: "#8cff5a" },
  { K: "#1a0f06", D: "#6b4423", S: "#a5703c", L: "#d9a05c", P: "#8a5b30", B: "#d9a05c", N: "#8cff5a", G: "#d9a05c", Y: "#f0c489", H: "#6b4423", M: "#8cff5a" },
  { K: "#14161a", D: "#6f6f68", S: "#a8a8a2", L: "#dcdcd4", P: "#8f8f88", B: "#dcdcd4", N: "#8cff5a", G: "#dcdcd4", Y: "#ffffff", H: "#6f6f68", M: "#6ad8ff" },
  { K: "#0d1210", D: "#2a312c", S: "#46504a", L: "#707d74", P: "#38423b", B: "#f5b825", N: "#8cff5a", G: "#f5b825", Y: "#ffd95a", H: "#2a312c", M: "#6ad8ff" },
  { K: "#2a1a04", D: "#8a5a10", S: "#caa23e", L: "#ffd95a", P: "#b08a2c", B: "#fff0b8", N: "#8cff5a", G: "#ffd95a", Y: "#fff0b8", H: "#8a5a10", M: "#ff6ad8" },
  { K: "#3a2405", D: "#a5730f", S: "#f0bd35", L: "#ffe98a", P: "#d4a12a", B: "#ffffff", N: "#c4ff9e", G: "#ffe98a", Y: "#ffffff", H: "#a5730f", M: "#ff6ad8" },
];

const BODY_RUNS = PALETTES.map((_, level) => toRuns(buildBody(level)));
const DIAL_RUNS = toRuns(buildDial());

export const SAFE_LABELS = ["TIN CAN", "SAFE", "VAULT", "FORT", "GOLD RESERVE", "THE ONE"];

export const SafeSprite: React.FC<{
  level?: number;
  /** Угол поворота диска в градусах — считает вызывающая сцена из своего кадра. */
  dialAngle?: number;
  size: number;
  style?: React.CSSProperties;
}> = ({ level = 0, dialAngle = 0, size, style }) => {
  const lv = Math.max(0, Math.min(level, PALETTES.length - 1));
  const pal = PALETTES[lv];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", ...style }}
    >
      {BODY_RUNS[lv].map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={pal[r.k]} />
      ))}
      <g transform={`rotate(${dialAngle} ${CX} ${CY})`}>
        {DIAL_RUNS.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={pal[r.k]} />
        ))}
      </g>
    </svg>
  );
};

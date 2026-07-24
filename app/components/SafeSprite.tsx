/**
 * Пиксель-спрайт сейфа 32×32, собранный процедурно.
 *
 * Почему не картинка: сетка строится один раз в модуле, палитра подменяется по тиру,
 * диск вынесен в отдельную группу и крутится при заводе. Растровый спрайт так не оживить,
 * и он бы мылился при масштабировании — здесь всё остаётся пиксель-в-пиксель.
 */

type Key = "." | "K" | "D" | "S" | "L" | "P" | "B" | "N" | "G" | "Y" | "H";

const W = 32;
const H = 32;

const blank = (): Key[][] =>
  Array.from({ length: H }, () => Array<Key>(W).fill("."));

/** Прямоугольник со скруглёнными (по евклиду) углами. */
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
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r * r) g[y][x] = k;
    }
  }
}

function ring(
  g: Key[][],
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  k: Key,
) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d >= r0 && d <= r1) g[y][x] = k;
    }
  }
}

function rect(g: Key[][], x0: number, y0: number, x1: number, y1: number, k: Key) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = k;
}

/** Обводка: пустые клетки, соприкасающиеся с телом, красим в контур. */
function outline(g: Key[][], k: Key) {
  const src = g.map((r) => r.slice());
  for (let y = 0; y < H; y++) {
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
}

const CX = 16;
const CY = 15;

/** Корпус сейфа: рама, утопленная дверь, болты, петли, ручка, золотая V. */
function buildBody(): Key[][] {
  const g = blank();

  // корпус + фаска
  roundRect(g, 3, 2, 28, 29, 3, "S");
  roundRect(g, 3, 2, 28, 4, 3, "L"); // верхний блик
  rect(g, 3, 27, 28, 29, "D"); // нижняя тень
  rect(g, 3, 5, 4, 26, "L"); // левый блик
  rect(g, 27, 5, 28, 26, "D"); // правая тень

  // утопленная дверь
  roundRect(g, 7, 6, 24, 25, 2, "P");
  rect(g, 7, 6, 24, 6, "D"); // верхняя кромка ниши
  rect(g, 7, 25, 24, 25, "L"); // нижняя кромка ниши

  // болты-заклёпки по углам рамы (светлая шляпка + тёмная сердцевина)
  ([[5, 4], [25, 4], [5, 26], [25, 26]] as [number, number][]).forEach(([bx, by]) => {
    rect(g, bx, by, bx + 1, by + 1, "B");
    g[by + 1][bx] = "D";
  });

  // петли слева
  rect(g, 1, 9, 3, 12, "D");
  rect(g, 1, 19, 3, 22, "D");
  rect(g, 1, 10, 1, 11, "K");
  rect(g, 1, 20, 1, 21, "K");

  // ручка-рычаг справа
  rect(g, 28, 14, 30, 16, "H");
  rect(g, 30, 13, 30, 17, "H");

  // ниша под диск: тонкий тёмный зазор, чтобы диск читался как отдельная деталь
  disc(g, CX, CY, 6.8, "D");
  disc(g, CX, CY, 6.2, "K");

  // латунная табличка внизу дверцы — ниже досягаемости спиц диска (они доходят до y=22)
  rect(g, 12, 23, 19, 24, "D");
  rect(g, 12, 23, 19, 23, "G");
  g[23][12] = "Y";
  g[23][19] = "Y";

  outline(g, "K");
  return g;
}

/** Диск-замок: крутится при заводе, в центре — неоновое ядро. */
function buildDial(): Key[][] {
  const g = blank();
  ring(g, CX, CY, 3.4, 6.0, "S");
  ring(g, CX, CY, 5.3, 6.0, "L");
  ring(g, CX, CY, 3.4, 4.0, "D");

  // спицы
  rect(g, CX, CY - 7, CX, CY - 4, "L");
  rect(g, CX, CY + 4, CX, CY + 7, "L");
  rect(g, CX - 7, CY, CX - 4, CY, "L");
  rect(g, CX + 4, CY, CX + 7, CY, "L");
  // рукоятки на концах спиц
  rect(g, CX - 1, CY - 7, CX + 1, CY - 7, "S");
  rect(g, CX - 1, CY + 7, CX + 1, CY + 7, "S");
  rect(g, CX - 7, CY - 1, CX - 7, CY + 1, "S");
  rect(g, CX + 7, CY - 1, CX + 7, CY + 1, "S");

  disc(g, CX, CY, 2.2, "N"); // неоновое ядро
  return g;
}

interface Run {
  x: number;
  y: number;
  w: number;
  /** Прозрачные клетки в серии не попадают, поэтому "." здесь невозможен. */
  k: Exclude<Key, ".">;
}

/** Схлопываем горизонтальные серии — вместо 1024 клеток получаем ~200 прямоугольников. */
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
      runs.push({ x, y, w, k });
      x += w;
    }
  }
  return runs;
}

// Считаем один раз на модуль: форма у всех тиров общая, меняется только палитра.
const BODY_RUNS = toRuns(buildBody());
const DIAL_RUNS = toRuns(buildDial());

type Palette = Record<Exclude<Key, ".">, string>;

const TIER_PALETTES: Palette[] = [
  // 01 TIN CAN — тусклая жесть
  { K: "#1b1712", D: "#6f6a5c", S: "#9a9384", L: "#c6bfae", P: "#857e70", B: "#c6bfae", N: "#8cff5a", G: "#f5b825", Y: "#ffd95a", H: "#6f6a5c" },
  // 02 SAFE — бурая сталь
  { K: "#180f07", D: "#4a3422", S: "#7a5a3a", L: "#a88159", P: "#63482f", B: "#c9a06a", N: "#8cff5a", G: "#f5b825", Y: "#ffd95a", H: "#4a3422" },
  // 03 VAULT — синеватая сталь
  { K: "#10161a", D: "#33414a", S: "#5c6b74", L: "#8fa5b0", P: "#47555d", B: "#9fb4bd", N: "#8cff5a", G: "#f5b825", Y: "#ffd95a", H: "#33414a" },
  // 04 FORT — тёмная сталь с золотыми болтами
  { K: "#0d1210", D: "#2a312c", S: "#46504a", L: "#707d74", P: "#38423b", B: "#f5b825", N: "#8cff5a", G: "#ffd95a", Y: "#fff0b8", H: "#2a312c" },
  // 05 GOLD RESERVE — золото
  { K: "#2a1a04", D: "#8a5a10", S: "#caa23e", L: "#ffd95a", P: "#b08a2c", B: "#fff0b8", N: "#8cff5a", G: "#fff0b8", Y: "#ffffff", H: "#8a5a10" },
];

export default function SafeSprite({
  tier = 0,
  spinning = false,
  stalled = false,
}: {
  tier?: number;
  spinning?: boolean;
  stalled?: boolean;
}) {
  const pal = TIER_PALETTES[Math.min(tier, TIER_PALETTES.length - 1)];
  const cls =
    "safe-sprite" + (spinning ? " is-spinning" : "") + (stalled ? " is-stalled" : "");

  return (
    <svg
      className={cls}
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      role="img"
      aria-label={`Vault tier ${tier + 1}${stalled ? ", stalled" : spinning ? ", winding" : ""}`}
    >
      {BODY_RUNS.map((r, i) => (
        <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={pal[r.k]} />
      ))}
      <g className="dial">
        {DIAL_RUNS.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={1} fill={pal[r.k]} />
        ))}
      </g>
    </svg>
  );
}

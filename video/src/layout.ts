import { useVideoConfig } from "remotion";

/**
 * Одна вёрстка на три формата (16:9, 9:16, 1:1).
 *
 * Ролик собирается не в пикселях, а в юнитах `u = min(width, height) / 100`. Причина
 * простая: размеры кадра у форматов разные, и любой захардкоженный `fontSize: 64`
 * в вертикали либо не влезает, либо теряется. Юнит привязан к КОРОТКОЙ стороне —
 * тогда текст не переполняет кадр ни в одном из трёх.
 *
 * `vertical` переключает колонки на строки: в 9:16 три карточки в ряд нечитаемы.
 */
export interface Layout {
  u: number;
  vertical: boolean;
  /** Ширина контентной колонки в юнитах — аналог `.shell` на сайте. */
  shell: number;
  width: number;
  height: number;
  fps: number;
}

export const useLayout = (): Layout => {
  const { width, height, fps } = useVideoConfig();
  const u = Math.min(width, height) / 100;
  const vertical = height > width;
  return {
    u,
    vertical,
    shell: (width / u) * (vertical ? 0.9 : 0.82),
    width,
    height,
    fps,
  };
};

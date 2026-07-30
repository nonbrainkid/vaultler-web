/**
 * Палитра и типографика ролика — снята один в один с `app/globals.css` сайта.
 *
 * Дублирование намеренное: video/ — отдельный npm-пакет без доступа к алиасу `@/`,
 * а тянуть CSS-переменные Next-приложения в рендерер значило бы связать сборку ролика
 * с фронтендом. Если палитра на сайте поедет, ролик надо править вручную — зато
 * рендер не сломается от рефакторинга стилей.
 */

export const C = {
  void: "#0f0a06",
  ink: "#171009",
  woodDarker: "#241708",
  woodDark: "#3a2418",
  wood: "#5c3520",
  woodLite: "#7a4a28",
  steelDark: "#2f3330",
  steel: "#5c5c55",
  steelLite: "#9a9a90",

  skyHi: "#f8dc7a",
  sky: "#f5c518",
  amber: "#e8a41e",
  sand: "#d99a1f",
  mesa: "#8b5a2b",
  mesaDeep: "#6b3a24",

  neon: "#8cff5a",
  neonHi: "#c4ff9e",
  neon2: "#5fbf3a",
  neonDeep: "#2e7d32",

  goldHi: "#ffd95a",
  gold: "#f5b825",
  goldLo: "#8a5a10",

  rust: "#b03a24",
  rustHi: "#e05a3a",

  bone: "#f0e6d2",
  muted: "#b3987a",
} as const;

/** Тени-свечения. Вынесены в константы, потому что повторяются в каждой сцене. */
export const GLOW = {
  neon: `0 0 0.6em ${C.neon}66, 0 0 1.4em ${C.neon}33`,
  gold: `0 0 0.6em ${C.gold}66, 0 0 1.4em ${C.gold}33`,
  rust: `0 0 0.6em ${C.rustHi}66, 0 0 1.4em ${C.rust}33`,
} as const;

/** Пиксельная «рамка доски»: три слоя дерева, как у `.card` на сайте. */
export const woodFrame = (u: number) => ({
  border: `${0.45 * u}px solid ${C.woodDarker}`,
  outline: `${0.25 * u}px solid ${C.wood}`,
  outlineOffset: `${-0.9 * u}px`,
  background: `linear-gradient(180deg, ${C.ink}, ${C.void})`,
});

/**
 * Те же два шрифта, что и на сайте (`app/layout.tsx`): Press Start 2P на заголовки,
 * VT323 на тело и цифры.
 *
 * `@remotion/google-fonts` сам оборачивает загрузку в `delayRender`, поэтому кадр не
 * начнёт рендериться, пока шрифт не готов — иначе первые кадры уехали бы на системном
 * фолбэке и ролик «прыгал» бы на старте.
 */
import { loadFont as loadPixel } from "@remotion/google-fonts/PressStart2P";
import { loadFont as loadMono } from "@remotion/google-fonts/VT323";

export const PIXEL = loadPixel("normal", { weights: ["400"], subsets: ["latin"] })
  .fontFamily;
export const MONO = loadMono("normal", { weights: ["400"], subsets: ["latin"] })
  .fontFamily;

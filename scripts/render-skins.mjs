// Dev-утилита: собрать все скины сейфа в одну картинку для визуальной проверки.
import sharp from "sharp";
const out = process.argv[2];
const html = await (await fetch("http://localhost:3000")).text();
const all = [...html.matchAll(/<svg class="safe-sprite[\s\S]*?<\/svg>/g)].map((m) => m[0]);
if (!all.length) { console.error("no sprites"); process.exit(1); }
const uniq = all.slice(0, 6);
const CELL = 160;
const tiles = await Promise.all(
  uniq.map(async (svg) => {
    const s = svg
      .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" ')
      .replace(/class="[^"]*"/g, "");
    return sharp(Buffer.from(s)).resize(CELL, CELL, { kernel: "nearest" }).png().toBuffer();
  }),
);
await sharp({
  create: { width: CELL * tiles.length, height: CELL, channels: 4, background: "#171009" },
})
  .composite(tiles.map((input, i) => ({ input, left: i * CELL, top: 0 })))
  .png()
  .toFile(out);
console.log("rendered", tiles.length, "skins →", out);

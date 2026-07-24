// Утилита разработки: вытащить отрендеренный спрайт со страницы и сохранить в PNG,
// чтобы можно было оценить пиксель-арт глазами.
import sharp from "sharp";
const out = process.argv[2];
const html = await (await fetch("http://localhost:3000")).text();
const m = html.match(/<svg class="safe-sprite[\s\S]*?<\/svg>/);
if (!m) { console.error("sprite not found"); process.exit(1); }
const svg = m[0]
  .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" ')
  .replace(/class="[^"]*"/g, "");
await sharp(Buffer.from(svg))
  .resize(384, 384, { kernel: "nearest" })
  .flatten({ background: "#171009" })
  .png()
  .toFile(out);
console.log("rendered", out);

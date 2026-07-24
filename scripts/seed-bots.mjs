/**
 * Dev-сидер: набивает лидерборд ботами, чтобы проверить ранги и гейтинг скинов
 * (топ-100 включается только при >100 игроков — без массовки это не потрогать).
 *
 * Боты пишутся в файловый стор (.data/players.json) с префиксом `bot:` — они всегда
 * отличимы на борде и вычищаются одной командой. В прод это не едет: при заданном
 * DATABASE_URL скрипт отказывается работать.
 *
 *   node scripts/seed-bots.mjs 239     # засеять 239 ботов
 *   node scripts/seed-bots.mjs --clear # убрать всех ботов
 *
 * После запуска dev-сервер нужно перезапустить: файловый стор кэширует данные в памяти.
 */
import { promises as fs } from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), ".data", "players.json");

if (process.env.DATABASE_URL) {
  console.error(
    "Отказ: задан DATABASE_URL. Сидер только для локального файлового стора,\n" +
      "фейковые игроки в реальном борде недопустимы.",
  );
  process.exit(1);
}

const FIRST = [
  "Dusty", "Cactus", "Rusty", "Slim", "Doc", "Wild", "Lucky", "Rowdy", "Gritty",
  "Ol'", "Sly", "Mad", "Quiet", "Iron", "Copper", "Silver", "Crooked", "Lonesome",
  "Tumbleweed", "Buckshot", "Whiskey", "Dead-Eye", "Sundown", "Hollow", "Ragged",
];
const LAST = [
  "Pete", "Jane", "Colt", "Boone", "Hollis", "Mabel", "Cassidy", "Rook", "Mose",
  "Bell", "Hicks", "Dalton", "Cole", "Ruth", "Vance", "Kettle", "Briggs", "Tate",
  "Sawyer", "Quinn", "Hatch", "Reed", "Mercer", "Ford", "Grimes", "Ash", "Wren",
];

function makeNames(n) {
  const out = new Set();
  let guard = 0;
  while (out.size < n && guard++ < n * 60) {
    const f = FIRST[Math.floor(Math.random() * FIRST.length)];
    const l = LAST[Math.floor(Math.random() * LAST.length)];
    out.add(`${f} ${l}`);
  }
  // если комбинаций не хватило — добиваем номерами
  let i = 1;
  while (out.size < n) out.add(`Drifter ${i++}`);
  return [...out];
}

/**
 * Степенное распределение: большинство внизу, единицы в отрыве.
 * Плоский random() дал бы неестественно ровный борд.
 */
function randomStack() {
  return 40 + Math.round(Math.pow(Math.random(), 2.6) * 46000);
}

async function readStore() {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeStore(data) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2));
}

const args = process.argv.slice(2);
const clear = args.includes("--clear");
const count = Number(args.find((a) => /^\d+$/.test(a)) ?? 239);

const data = await readStore();
const before = Object.keys(data).length;

for (const k of Object.keys(data)) if (k.startsWith("bot:")) delete data[k];
const realPlayers = Object.keys(data).length;

if (clear) {
  await writeStore(data);
  console.log(`Убрано ботов: ${before - realPlayers}. Осталось игроков: ${realPlayers}.`);
  console.log("Перезапусти dev-сервер, чтобы стор перечитал файл.");
  process.exit(0);
}

const now = Date.now();
for (const name of makeNames(count)) {
  data[`bot:${name}`] = {
    stack: randomStack(),
    streak: Math.floor(Math.random() * 16),
    lastCrankAt: null,
    lastSettleAt: now,
    // Машины выключены намеренно: иначе settle на каждом чтении борда крутил бы
    // им начисления и рейды, и цифры плыли бы при каждом запросе.
    machineOn: false,
    boost: Math.random() < 0.3,
  };
}

await writeStore(data);

const stacks = Object.entries(data)
  .filter(([k]) => k.startsWith("bot:"))
  .map(([, v]) => v.stack)
  .sort((a, b) => b - a);

console.log(`Засеяно ботов: ${count}. Всего игроков: ${Object.keys(data).length}.`);
console.log(`Стек ботов: max ${stacks[0]}, медиана ${stacks[Math.floor(stacks.length / 2)]}, min ${stacks.at(-1)}.`);
console.log("Перезапусти dev-сервер, чтобы стор перечитал файл.");

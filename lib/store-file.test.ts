/**
 * Файловый стор: источник правды — ФАЙЛ, а не копия в памяти экземпляра.
 *
 * Регрессия, из-за которой это покрыто тестами. `FileStore` читал файл один раз и дальше
 * жил своей копией. Next-HMR за сессию правок создаёт несколько экземпляров модуля
 * `lib/store.ts` (у каждого свой синглтон), и роуты начинали расходиться в показаниях:
 * `POST /api/crank` заводил машину и писал файл, а `GET /api/state` из другого экземпляра
 * продолжал отвечать «machine is off, стек 0». В игре это выглядело как поломка петли —
 * стакание обрывалось через один интервал поллинга (~2.5 с) после нажатия CRANK.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileStore } from "./store-file";
import { crank, initialState, settle, type PlayerState } from "./game";

const T0 = 1_700_000_000_000;

let dir: string;
let file: string;
let cwd: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "vaultler-store-"));
  file = path.join(dir, ".data", "players.json");
  // FileStore берёт путь от process.cwd() в момент создания — подменяем на временный каталог.
  cwd = vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(async () => {
  cwd.mockRestore();
  await fs.rm(dir, { recursive: true, force: true });
});

async function writeRaw(data: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

describe("файловый стор: свежесть данных между экземплярами", () => {
  /** Тот самый баг: кранк в одном экземпляре, чтение — в другом. */
  it("чужая запись видна следующему чтению без перезапуска", async () => {
    const writer = new FileStore();
    const reader = new FileStore();

    // reader снимает копию ДО кранка — как роут /api/state, поднятый на старте страницы.
    expect((await reader.read("dev:a", T0)).machineOn).toBe(false);

    await writer.mutate("dev:a", T0, (s) => {
      const r = crank(s, T0);
      return { state: r.state, result: r };
    });

    const seen = await reader.read("dev:a", T0 + 1000);
    expect(seen.machineOn).toBe(true);
    expect(seen.streak).toBe(1);
    expect(seen.lastCrankAt).toBe(T0);
  });

  it("стек продолжает капать по данным из файла, а не обрывается", async () => {
    const writer = new FileStore();
    const reader = new FileStore();
    await reader.read("dev:a", T0); // прогреваем устаревшую копию

    await writer.mutate("dev:a", T0, (s) => {
      const r = crank(s, T0, { tier: 2, ppb: 60_000 });
      return { state: r.state, result: r };
    });

    // Так делает GET /api/state: читает и досчитывает settle в памяти.
    const after = (state: PlayerState, ms: number) => settle(state, T0 + ms).state.stack;
    const s1 = after(await reader.read("dev:a", T0 + 2_500), 2_500);
    const s2 = after(await reader.read("dev:a", T0 + 60_000), 60_000);
    expect(s1).toBeGreaterThan(0);
    expect(s2).toBeGreaterThan(s1);
  });

  it("правка файла со стороны (сидер ботов) подхватывается", async () => {
    const store = new FileStore();
    await store.snapshot(); // копия снята

    await writeRaw({
      "bot:Dusty Pete": { ...initialState(T0), stack: 12_345 },
    });

    const rows = await store.snapshot();
    expect(rows).toHaveLength(1);
    expect(rows[0].state.stack).toBe(12_345);
  });

  it("запись одного экземпляра не затирает запись другого", async () => {
    const a = new FileStore();
    const b = new FileStore();

    await a.mutate("dev:a", T0, (s) => ({ state: { ...s, stack: 111 }, result: null }));
    await b.mutate("dev:b", T0, (s) => ({ state: { ...s, stack: 222 }, result: null }));

    // Оба игрока должны быть в файле: b перечитал его перед своей записью.
    const onDisk = JSON.parse(await fs.readFile(file, "utf8"));
    expect(onDisk["dev:a"].stack).toBe(111);
    expect(onDisk["dev:b"].stack).toBe(222);
    expect((await a.read("dev:b", T0)).stack).toBe(222);
  });

  it("удалённый файл = чистый стор (ручной сброс данных уважаем)", async () => {
    const store = new FileStore();
    await store.mutate("dev:a", T0, (s) => ({ state: { ...s, stack: 5 }, result: null }));
    expect((await store.read("dev:a", T0)).stack).toBe(5);

    await fs.rm(file);
    expect((await store.read("dev:a", T0)).stack).toBe(0);
    expect(await store.snapshot()).toEqual([]);
  });

  it("битый JSON не роняет стор и не обнуляет игрока молча", async () => {
    const store = new FileStore();
    await store.mutate("dev:a", T0, (s) => ({ state: { ...s, stack: 7 }, result: null }));

    await fs.writeFile(file, "{ это не json");
    // Читаем то, что уже знали, вместо падения роута.
    expect((await store.read("dev:a", T0)).stack).toBe(7);
  });

  /** Старый формат (булев boost) не должен давать верхний множитель. */
  it("легаси-запись с boost:true поднимается только до первой ступени", async () => {
    await writeRaw({
      "wallet:0xabc": {
        stack: 100,
        streak: 3,
        lastCrankAt: null,
        lastSettleAt: T0,
        machineOn: false,
        boost: true,
        nickname: "oldtimer",
        hideWallet: false,
      },
    });

    const s = await new FileStore().read("wallet:0xabc", T0);
    expect(s.boostTier).toBe(1);
    expect(s.boostPpb).toBe(0);
    expect(s.nickname).toBe("oldtimer");
    expect(s.stack).toBe(100);
  });

  it("ник остаётся уникальным при проверке против свежего файла", async () => {
    const a = new FileStore();
    const b = new FileStore();
    await a.setProfile("dev:a", T0, { nickname: "Sheriff" });

    // b о занятом нике узнаёт из файла, а не из своей устаревшей копии.
    const res = await b.setProfile("dev:b", T0, { nickname: "sheriff" });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("nickname_taken");
  });

  it("параллельные кранки одного игрока не начисляют дважды", async () => {
    const store = new FileStore();
    const one = () =>
      store.mutate("dev:a", T0, (s) => {
        const r = crank(s, T0);
        return { state: r.state, result: r };
      });

    const results = await Promise.all([one(), one(), one()]);
    // Первый заводит машину, остальные попадают в winding и отклоняются.
    expect(results.filter((r) => r.result.ok)).toHaveLength(1);
    expect((await store.read("dev:a", T0)).streak).toBe(1);
  });
});

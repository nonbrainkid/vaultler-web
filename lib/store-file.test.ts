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

describe("поиск игрока по нику (вход на /u/[nick])", () => {
  it("находит без учёта регистра — уникальность ника тоже без регистра", async () => {
    const store = new FileStore();
    await store.setProfile("wallet:0xabc", T0, { nickname: "Egor" });

    for (const probe of ["Egor", "egor", "EGOR"]) {
      const found = await store.playerByNickname(probe);
      expect(found?.identity).toBe("wallet:0xabc");
      expect(found?.state.nickname).toBe("Egor"); // регистр отображения сохранён
    }
  });

  it("неизвестный и пустой ник — null, а не первый попавшийся игрок", async () => {
    const store = new FileStore();
    // Игрок БЕЗ ника: пустой ключ не должен «находить» его в nullable-поле.
    await store.mutate("dev:a", T0, (s) => ({ state: s, result: null }));
    expect(await store.playerByNickname("nobody")).toBeNull();
    expect(await store.playerByNickname("")).toBeNull();
    expect(await store.playerByNickname("   ")).toBeNull();
  });

  it("ник, стёртый игроком, перестаёт находиться — это и есть выключатель страницы", async () => {
    const store = new FileStore();
    await store.setProfile("wallet:0xabc", T0, { nickname: "egor" });
    await store.setProfile("wallet:0xabc", T0, { nickname: null });
    expect(await store.playerByNickname("egor")).toBeNull();
  });

  it("ник, заданный одним экземпляром, виден другому без перезапуска dev-сервера", async () => {
    const writer = new FileStore();
    const reader = new FileStore();
    await reader.playerByNickname("egor"); // прогреваем устаревшую копию
    await writer.setProfile("wallet:0xabc", T0, { nickname: "egor" });
    expect((await reader.playerByNickname("egor"))?.identity).toBe("wallet:0xabc");
  });
});

describe("привязка Telegram: 1:1 в обе стороны", () => {
  it("линкует identity к chatId и находится обратно", async () => {
    const store = new FileStore();
    const res = await store.linkTelegram("dev:a", 111, T0);
    expect(res.displacedChatId).toBeNull();
    expect(await store.telegramChatIdFor("dev:a")).toBe(111);
    expect(await store.telegramLinks()).toEqual([{ identity: "dev:a", chatId: 111 }]);
  });

  it("перепривязка того же identity к новому chatId возвращает старый как displaced", async () => {
    const store = new FileStore();
    await store.linkTelegram("dev:a", 111, T0);
    const res = await store.linkTelegram("dev:a", 222, T0 + 1000);
    expect(res.displacedChatId).toBe(111);
    expect(await store.telegramChatIdFor("dev:a")).toBe(222);
    // Старая запись реально удалена, а не просто добавлена вторая строка.
    expect(await store.telegramLinks()).toEqual([{ identity: "dev:a", chatId: 222 }]);
  });

  it("тот же chatId у другого identity тихо освобождается (1:1 по обе стороны)", async () => {
    const store = new FileStore();
    await store.linkTelegram("dev:a", 111, T0);
    const res = await store.linkTelegram("dev:b", 111, T0);
    expect(res.displacedChatId).toBeNull(); // у dev:b раньше привязки не было
    expect(await store.telegramChatIdFor("dev:a")).toBeNull(); // старая связь снята
    expect(await store.telegramChatIdFor("dev:b")).toBe(111);
  });

  it("повторная привязка того же chatId к тому же identity — не задваивает запись", async () => {
    const store = new FileStore();
    await store.linkTelegram("dev:a", 111, T0);
    const res = await store.linkTelegram("dev:a", 111, T0 + 1000);
    expect(res.displacedChatId).toBeNull();
    expect(await store.telegramLinks()).toEqual([{ identity: "dev:a", chatId: 111 }]);
  });

  it("unlinkTelegramByIdentity удаляет привязку физически и возвращает старый chatId", async () => {
    const store = new FileStore();
    await store.linkTelegram("dev:a", 111, T0);
    expect(await store.unlinkTelegramByIdentity("dev:a")).toBe(111);
    expect(await store.telegramChatIdFor("dev:a")).toBeNull();
    expect(await store.telegramLinks()).toEqual([]);
    // Повторная отписка — не ошибка, просто "нечего отвязывать".
    expect(await store.unlinkTelegramByIdentity("dev:a")).toBeNull();
  });

  it("unlinkTelegramByChatId (команда /stop) возвращает identity, если он был", async () => {
    const store = new FileStore();
    await store.linkTelegram("wallet:0xabc", 999, T0);
    expect(await store.unlinkTelegramByChatId(999)).toBe("wallet:0xabc");
    expect(await store.unlinkTelegramByChatId(999)).toBeNull();
  });

  it("привязки живут в своём файле, а не внутри players.json", async () => {
    const store = new FileStore();
    await store.linkTelegram("dev:a", 111, T0);
    // players.json не тронут отдельным файлом привязок — схему, которую читает
    // hydrateState построчно, подмешивание сломало бы.
    await expect(fs.readFile(file, "utf8")).rejects.toThrow();
  });

  it("привязка, сделанная одним экземпляром, видна другому без перезапуска", async () => {
    const writer = new FileStore();
    const reader = new FileStore();
    await writer.linkTelegram("dev:a", 111, T0);
    expect(await reader.telegramChatIdFor("dev:a")).toBe(111);
  });
});

/**
 * Подписки на веб-пуши в файловом сторе. Без этой поддержки разработка второго канала
 * напоминаний требовала бы Postgres — а «БД для разработки не нужна» — правило проекта.
 */
describe("подписки на веб-пуши (dev-стор)", () => {
  const SUB_A = { endpoint: "https://push.example.com/a", p256dh: "pA", auth: "aA" };
  const SUB_B = { endpoint: "https://push.example.com/b", p256dh: "pB", auth: "aB" };

  it("сохраняет подписку и считает её только своему игроку", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    expect(await store.countPushSubscriptions("dev:a")).toBe(1);
    expect(await store.countPushSubscriptions("dev:b")).toBe(0);
    expect(await store.pushSubscriptions()).toEqual([
      { identity: "dev:a", ...SUB_A, failures: 0, createdAt: T0 },
    ]);
  });

  it("два устройства одного игрока — две записи (связь не 1:1, в отличие от Telegram)", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    await store.savePushSubscription("dev:a", SUB_B, T0 + 1);
    expect(await store.countPushSubscriptions("dev:a")).toBe(2);
  });

  it("тот же endpoint после входа кошельком ПЕРЕВЕШИВАЕТСЯ, а не задваивается", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    await store.notePushResult(SUB_A.endpoint, false);
    // Один и тот же браузер: анонимная сессия превратилась в кошельковую.
    await store.savePushSubscription("wallet:0xabc", SUB_A, T0 + 1000);
    const all = await store.pushSubscriptions();
    expect(all).toHaveLength(1);
    expect(all[0].identity).toBe("wallet:0xabc");
    // Подписку только что подтвердил живой браузер — счётчик неудач обнулён.
    expect(all[0].failures).toBe(0);
    expect(await store.countPushSubscriptions("dev:a")).toBe(0);
  });

  it("отписка с сайта удаляет только СВОЮ подписку", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    // Чужой endpoint не удаляется, даже если его прислали в теле запроса.
    expect(await store.deletePushSubscription("dev:b", SUB_A.endpoint)).toBe(false);
    expect(await store.countPushSubscriptions("dev:a")).toBe(1);

    expect(await store.deletePushSubscription("dev:a", SUB_A.endpoint)).toBe(true);
    expect(await store.pushSubscriptions()).toEqual([]);
    // Повторная отписка — не ошибка, просто нечего удалять.
    expect(await store.deletePushSubscription("dev:a", SUB_A.endpoint)).toBe(false);
  });

  it("удаление по endpoint'у (410 от push-сервиса) владельца не спрашивает", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    expect(await store.deletePushSubscriptionByEndpoint(SUB_A.endpoint)).toBe(true);
    expect(await store.deletePushSubscriptionByEndpoint(SUB_A.endpoint)).toBe(false);
  });

  it("notePushResult копит неудачи и обнуляется успехом", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    expect(await store.notePushResult(SUB_A.endpoint, false)).toBe(1);
    expect(await store.notePushResult(SUB_A.endpoint, false)).toBe(2);
    expect(await store.notePushResult(SUB_A.endpoint, true)).toBe(0);
    // Записи нет — 0, а не исключение: её мог удалить параллельный прогон рассылки.
    expect(await store.notePushResult("https://push.example.com/zzz", false)).toBe(0);
  });

  it("подписки живут в своём файле, а не внутри players.json", async () => {
    const store = new FileStore();
    await store.savePushSubscription("dev:a", SUB_A, T0);
    await expect(fs.readFile(file, "utf8")).rejects.toThrow();
  });

  it("подписка, сделанная одним экземпляром, видна другому без перезапуска", async () => {
    const writer = new FileStore();
    const reader = new FileStore();
    await writer.savePushSubscription("dev:a", SUB_A, T0);
    expect(await reader.countPushSubscriptions("dev:a")).toBe(1);
  });
});

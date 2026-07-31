/**
 * Рассылка веб-пушей: кому отправляем, как не задваиваем и когда удаляем подписку.
 *
 * Расписание («в какой фазе что уместно») общее с Telegram и проверено ещё и в
 * lib/telegram-remind.test.ts — здесь важно то, что специфично для пушей: у игрока может быть
 * несколько устройств, дедуп идёт по устройству, а мёртвые подписки исчезают сами.
 *
 * KV подменяется тем же способом, что в lib/ratelimit.test.ts / lib/telegram-remind.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAME, initialState, type PlayerState } from "./game";

const kvMock = {
  setIfAbsent: vi.fn<(key: string, ttlSec: number) => Promise<boolean>>(),
  bumpCounter: vi.fn(),
  setValue: vi.fn(),
  getAndDelete: vi.fn(),
  getMany: vi.fn(),
};
let kvUp = true;

vi.mock("./kv", () => ({
  getKv: () => (kvUp ? kvMock : null),
}));

const {
  MAX_PUSH_FAILURES,
  duePushReminders,
  pushFailureExhausted,
  reservePush,
  runPushReminders,
  resetPushRemindMemoryForTests,
} = await import("./push-remind");

beforeEach(() => {
  kvUp = true;
  kvMock.setIfAbsent.mockReset();
  resetPushRemindMemoryForTests();
});

const NOW = 2_000_000_000_000;

function stateAt(lastCrankAt: number | null): PlayerState {
  return {
    ...initialState(0),
    machineOn: lastCrankAt !== null,
    lastCrankAt,
    lastSettleAt: lastCrankAt ?? 0,
    streak: 1,
  };
}

function sub(endpoint: string, identity = "dev:a", failures = 0) {
  return { identity, endpoint, p256dh: "p", auth: "a", failures };
}

describe("duePushReminders — по одному сообщению на (устройство × событие)", () => {
  it("окно только что открылось — window_open на каждое устройство игрока", () => {
    const players = [{ identity: "dev:a", state: stateAt(NOW - GAME.WIND_MS) }];
    const due = duePushReminders(
      players,
      [sub("https://push.example.com/1"), sub("https://push.example.com/2")],
      NOW,
    );
    expect(due.map((d) => [d.endpoint, d.kind])).toEqual([
      ["https://push.example.com/1", "window_open"],
      ["https://push.example.com/2", "window_open"],
    ]);
  });

  it("последний час перед рейдером — оба события, окно первым", () => {
    const lastCrankAt = NOW - GAME.WIND_MS - GAME.GRACE_MS + 60 * 60 * 1000;
    const due = duePushReminders(
      [{ identity: "dev:a", state: stateAt(lastCrankAt) }],
      [sub("https://push.example.com/1")],
      NOW,
    );
    expect(due.map((d) => d.kind)).toEqual(["window_open", "raid_warning"]);
  });

  it("машина ещё заводится (winding) — ничего", () => {
    const due = duePushReminders(
      [{ identity: "dev:a", state: stateAt(NOW - 1000) }],
      [sub("https://push.example.com/1")],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("после рейда и при выключенной машине — ничего", () => {
    const stalled = stateAt(NOW - GAME.WIND_MS - GAME.GRACE_MS - 1000);
    const off = stateAt(null);
    const subs = [sub("https://push.example.com/1")];
    expect(duePushReminders([{ identity: "dev:a", state: stalled }], subs, NOW)).toEqual([]);
    expect(duePushReminders([{ identity: "dev:a", state: off }], subs, NOW)).toEqual([]);
  });

  it("подписка чужого игрока не получает уведомлений соседа", () => {
    const due = duePushReminders(
      [{ identity: "dev:a", state: stateAt(NOW - GAME.WIND_MS) }],
      [sub("https://push.example.com/9", "dev:other")],
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("подписок нет вовсе — пустой список без обхода игроков", () => {
    expect(duePushReminders([{ identity: "dev:a", state: stateAt(NOW - GAME.WIND_MS) }], [], NOW))
      .toEqual([]);
  });

  it("переносит failures в due — прогон решает по нему, пора ли удалять подписку", () => {
    const due = duePushReminders(
      [{ identity: "dev:a", state: stateAt(NOW - GAME.WIND_MS) }],
      [sub("https://push.example.com/1", "dev:a", 3)],
      NOW,
    );
    expect(due[0].failures).toBe(3);
  });
});

describe("reservePush — идемпотентность по (endpoint, lastCrankAt, kind)", () => {
  const r = (endpoint: string, lastCrankAt = 1000) => ({
    ...sub(endpoint),
    kind: "window_open" as const,
    lastCrankAt,
  });

  it("первый раз разрешает, повторный для того же цикла — нет", async () => {
    kvMock.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await reservePush(r("https://push.example.com/1"), NOW)).toBe(true);
    expect(await reservePush(r("https://push.example.com/1"), NOW)).toBe(false);
  });

  it("второе устройство того же игрока получает СВОЙ слот (ключ по endpoint'у)", async () => {
    kvMock.setIfAbsent.mockResolvedValue(true);
    await reservePush(r("https://push.example.com/1"), NOW);
    await reservePush(r("https://push.example.com/2"), NOW);
    const keys = kvMock.setIfAbsent.mock.calls.map(([k]) => k);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("новый lastCrankAt (новый цикл завода) — новый слот", async () => {
    kvMock.setIfAbsent.mockResolvedValue(true);
    await reservePush(r("https://push.example.com/1", 1000), NOW);
    await reservePush(r("https://push.example.com/1", 2000), NOW);
    const keys = kvMock.setIfAbsent.mock.calls.map(([k]) => k);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("сам endpoint в ключ KV не попадает — только отпечаток", async () => {
    kvMock.setIfAbsent.mockResolvedValue(true);
    await reservePush(r("https://push.example.com/secret-capability"), NOW);
    expect(kvMock.setIfAbsent.mock.calls[0][0]).not.toContain("secret-capability");
  });

  it("работает и без KV (фолбэк в память) — тот же контракт одноразовости", async () => {
    kvUp = false;
    expect(await reservePush(r("https://push.example.com/1"), NOW)).toBe(true);
    expect(await reservePush(r("https://push.example.com/1"), NOW)).toBe(false);
  });
});

describe("runPushReminders — прогон с инжектированными зависимостями (без сети/стора)", () => {
  const due = [
    { ...sub("https://push.example.com/1", "dev:a"), kind: "window_open" as const, lastCrankAt: 1 },
    { ...sub("https://push.example.com/2", "dev:b"), kind: "raid_warning" as const, lastCrankAt: 2 },
  ];
  const deps = (over: Partial<Parameters<typeof runPushReminders>[2]> = {}) => ({
    reserve: async () => true,
    send: async () => ({ ok: true, gone: false }),
    drop: vi.fn(async () => {}),
    noteResult: vi.fn(async () => 0),
    ...over,
  });

  it("успешные отправки считаются в sent", async () => {
    const d = deps();
    expect(await runPushReminders(due, NOW, d)).toEqual({
      sent: 2,
      skippedDuplicate: 0,
      droppedGone: 0,
      droppedExhausted: 0,
      failed: 0,
    });
    // Счётчик неудач был 0 — лишней записи в стор быть не должно.
    expect(d.noteResult).not.toHaveBeenCalled();
  });

  it("успех после неудач обнуляет счётчик", async () => {
    const d = deps();
    const withFailures = [{ ...due[0], failures: 4 }];
    await runPushReminders(withFailures, NOW, d);
    expect(d.noteResult).toHaveBeenCalledWith("https://push.example.com/1", true);
  });

  it("дубликат (reserve вернул false) не отправляется вовсе", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, gone: false });
    const summary = await runPushReminders(due, NOW, deps({ reserve: async () => false, send }));
    expect(summary.skippedDuplicate).toBe(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("404/410 (gone) удаляет подписку немедленно, без счётчика", async () => {
    const d = deps({ send: async () => ({ ok: false, gone: true }) });
    const summary = await runPushReminders(due, NOW, d);
    expect(summary.droppedGone).toBe(2);
    expect(d.drop).toHaveBeenCalledWith("https://push.example.com/1");
    expect(d.noteResult).not.toHaveBeenCalled();
  });

  it("временный сбой копит счётчик, но подписку не трогает", async () => {
    const d = deps({
      send: async () => ({ ok: false, gone: false }),
      noteResult: vi.fn(async () => 1),
    });
    const summary = await runPushReminders(due, NOW, d);
    expect(summary).toMatchObject({ failed: 2, droppedExhausted: 0, droppedGone: 0 });
    expect(d.drop).not.toHaveBeenCalled();
  });

  it("исчерпание лимита неудач удаляет подписку", async () => {
    const d = deps({
      send: async () => ({ ok: false, gone: false }),
      noteResult: vi.fn(async () => MAX_PUSH_FAILURES),
    });
    const summary = await runPushReminders([due[0]], NOW, d);
    expect(summary.droppedExhausted).toBe(1);
    expect(d.drop).toHaveBeenCalledWith("https://push.example.com/1");
  });

  it("удалённая в этом же прогоне подписка не получает второе due-событие", async () => {
    // У одного устройства бывает и window_open, и raid_warning разом: после 410 второе
    // сообщение не должно ни отправляться, ни повторно удалять запись.
    const twoEvents = [
      { ...sub("https://push.example.com/1"), kind: "window_open" as const, lastCrankAt: 1 },
      { ...sub("https://push.example.com/1"), kind: "raid_warning" as const, lastCrankAt: 1 },
    ];
    const send = vi.fn().mockResolvedValue({ ok: false, gone: true });
    const d = deps({ send });
    const summary = await runPushReminders(twoEvents, NOW, d);
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary.droppedGone).toBe(1);
    expect(d.drop).toHaveBeenCalledTimes(1);
  });
});

describe("pushFailureExhausted", () => {
  it("одна-две неудачи живую подписку не убивают (чужая авария ≠ мёртвый endpoint)", () => {
    expect(pushFailureExhausted(1)).toBe(false);
    expect(pushFailureExhausted(MAX_PUSH_FAILURES - 1)).toBe(false);
  });
  it("достигнутый порог — убивают", () => {
    expect(pushFailureExhausted(MAX_PUSH_FAILURES)).toBe(true);
    expect(pushFailureExhausted(MAX_PUSH_FAILURES + 5)).toBe(true);
  });
});

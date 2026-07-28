/**
 * Логика напоминаний: момент считается СТРОГО из серверного стейта (lastCrankAt +
 * тайминги lib/game.ts), рассылка идемпотентна по (identity, lastCrankAt, kind), а
 * при 403 от Telegram привязка удаляется автоматически.
 *
 * KV подменяется тем же способом, что и в lib/ratelimit.test.ts / lib/telegram-link.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GAME, initialState, type PlayerState } from "./game";

const kvMock = {
  setIfAbsent: vi.fn<(key: string, ttlSec: number) => Promise<boolean>>(),
  bumpCounter: vi.fn(),
  setValue: vi.fn(),
  getAndDelete: vi.fn(),
};
let kvUp = true;

vi.mock("./kv", () => ({
  getKv: () => (kvUp ? kvMock : null),
}));

const {
  dueReminders,
  reserveReminder,
  runReminders,
  resetTelegramRemindMemoryForTests,
} = await import("./telegram-remind");

beforeEach(() => {
  kvUp = true;
  kvMock.setIfAbsent.mockReset();
  resetTelegramRemindMemoryForTests();
});

const NOW = 2_000_000_000_000;

/** Состояние игрока с машиной, заведённой `lastCrankAt` назад от NOW (null — выключена). */
function stateAt(lastCrankAt: number | null): PlayerState {
  return {
    ...initialState(0),
    machineOn: lastCrankAt !== null,
    lastCrankAt,
    lastSettleAt: lastCrankAt ?? 0,
    streak: 1,
  };
}

describe("dueReminders — только фаза ready, момент из серверного стейта", () => {
  it("winding (окно ещё не открылось) — ничего не due", () => {
    const state = stateAt(NOW - 1000);
    const due = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 111]]),
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("окно только что открылось — due window_open, но не raid_warning", () => {
    const state = stateAt(NOW - GAME.WIND_MS);
    const due = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 111]]),
      NOW,
    );
    expect(due).toEqual([
      { identity: "dev:a", chatId: 111, kind: "window_open", lastCrankAt: state.lastCrankAt },
    ]);
  });

  it("последний час перед рейдером — due и window_open, и raid_warning", () => {
    const lastCrankAt = NOW - GAME.WIND_MS - GAME.GRACE_MS + 60 * 60 * 1000; // час до рейда
    const state = stateAt(lastCrankAt);
    const due = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 111]]),
      NOW,
    );
    expect(due.map((d) => d.kind).sort()).toEqual(["raid_warning", "window_open"]);
  });

  it("после рейда (stall) — ничего не due, повторно спамить некого", () => {
    const lastCrankAt = NOW - GAME.WIND_MS - GAME.GRACE_MS - 1000;
    const state = stateAt(lastCrankAt);
    const due = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 111]]),
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("машина никогда не заводилась — ничего не due", () => {
    const state = stateAt(null);
    const due = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 111]]),
      NOW,
    );
    expect(due).toEqual([]);
  });

  it("игрок не привязан к боту — пропускается независимо от фазы", () => {
    const state = stateAt(NOW - GAME.WIND_MS);
    const due = dueReminders([{ identity: "dev:a", state }], new Map(), NOW);
    expect(due).toEqual([]);
  });

  it("кастомный warnBeforeMs двигает порог raid_warning", () => {
    const lastCrankAt = NOW - GAME.WIND_MS - (GAME.GRACE_MS - 30 * 60 * 1000); // 30 мин до рейда
    const state = stateAt(lastCrankAt);
    const narrow = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 1]]),
      NOW,
      15 * 60 * 1000,
    );
    expect(narrow.some((d) => d.kind === "raid_warning")).toBe(false); // 30 мин > порога 15

    const wide = dueReminders(
      [{ identity: "dev:a", state }],
      new Map([["dev:a", 1]]),
      NOW,
      60 * 60 * 1000,
    );
    expect(wide.some((d) => d.kind === "raid_warning")).toBe(true); // 30 мин < порога 60
  });
});

describe("reserveReminder — идемпотентность (identity, lastCrankAt, kind)", () => {
  it("первый раз разрешает, повторный для того же цикла — нет", async () => {
    kvMock.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const r = { identity: "dev:a", chatId: 1, kind: "window_open" as const, lastCrankAt: 1000 };
    expect(await reserveReminder(r, NOW)).toBe(true);
    expect(await reserveReminder(r, NOW)).toBe(false);
  });

  it("новый lastCrankAt (новый цикл завода) — новый ключ, новое разрешение", async () => {
    kvMock.setIfAbsent.mockResolvedValue(true);
    await reserveReminder({ identity: "dev:a", chatId: 1, kind: "window_open", lastCrankAt: 1000 }, NOW);
    await reserveReminder({ identity: "dev:a", chatId: 1, kind: "window_open", lastCrankAt: 2000 }, NOW);
    const keys = kvMock.setIfAbsent.mock.calls.map(([k]) => k);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("работает и без KV (фолбэк в память) — тот же контракт одноразовости", async () => {
    kvUp = false;
    const r = { identity: "dev:a", chatId: 1, kind: "raid_warning" as const, lastCrankAt: 5000 };
    expect(await reserveReminder(r, NOW)).toBe(true);
    expect(await reserveReminder(r, NOW)).toBe(false);
  });
});

describe("runReminders — прогон с инжектированными зависимостями (без сети/стора)", () => {
  const due = [
    { identity: "dev:a", chatId: 1, kind: "window_open" as const, lastCrankAt: 1000 },
    { identity: "dev:b", chatId: 2, kind: "raid_warning" as const, lastCrankAt: 2000 },
    { identity: "dev:c", chatId: 3, kind: "window_open" as const, lastCrankAt: 3000 },
  ];

  it("успешные отправки считаются в sent", async () => {
    const summary = await runReminders(due, NOW, {
      reserve: async () => true,
      send: async () => ({ ok: true, blocked: false }),
      unlink: vi.fn(),
    });
    expect(summary).toEqual({ sent: 3, skippedDuplicate: 0, unlinkedBlocked: 0, failed: 0 });
  });

  it("дубликат (reserve вернул false) не отправляется вовсе", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, blocked: false });
    const summary = await runReminders(due, NOW, {
      reserve: async () => false,
      send,
      unlink: vi.fn(),
    });
    expect(summary).toEqual({ sent: 0, skippedDuplicate: 3, unlinkedBlocked: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it("403 (blocked) автоматически отвязывает чат и не считается обычным провалом", async () => {
    const unlink = vi.fn();
    const summary = await runReminders(due, NOW, {
      reserve: async () => true,
      send: async (chatId) => (chatId === 2 ? { ok: false, blocked: true } : { ok: true, blocked: false }),
      unlink,
    });
    expect(summary).toEqual({ sent: 2, skippedDuplicate: 0, unlinkedBlocked: 1, failed: 0 });
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith(2);
  });

  it("прочие сбои (сеть, 429) считаются в failed, привязка не трогается", async () => {
    const unlink = vi.fn();
    const summary = await runReminders(due, NOW, {
      reserve: async () => true,
      send: async () => ({ ok: false, blocked: false }),
      unlink,
    });
    expect(summary).toEqual({ sent: 0, skippedDuplicate: 0, unlinkedBlocked: 0, failed: 3 });
    expect(unlink).not.toHaveBeenCalled();
  });
});

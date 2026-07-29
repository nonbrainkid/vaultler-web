import { describe, it, expect } from "vitest";
import { GAME, initialState, settle, type PlayerState } from "./game";
import { PAYOUT_SEATS } from "./payout";
import {
  addressOf,
  closedWeekOf,
  finalizeWeekWithShares,
  forfeitedShare,
  isPayoutEligible,
  occupiesSeat,
} from "./week-results";
import { weekInfo } from "./week";

const NOW = 1_760_000_000_000;
const W = (n: number) => `wallet:0xabc00000000000000000000000000000000000${String(n).padStart(2, "0")}`;

describe("closedWeekOf", () => {
  const base = initialState(NOW);

  it("нет перехода недели — нечего закрывать", () => {
    expect(closedWeekOf(base, { ...base, stack: 500 })).toBeNull();
  });

  it("переход недели отдаёт прирост как разницу баз", () => {
    const prev: PlayerState = { ...base, weekId: 100, weekStartStack: 1_000, stack: 1_800 };
    const next: PlayerState = { ...prev, weekId: 101, weekStartStack: 1_800 };
    expect(closedWeekOf(prev, next)).toEqual({ weekId: 100, gain: 800 });
  });

  /** weekId 0 = запись до введения недельного цикла или свежий игрок: закрывать нечего. */
  it("нулевой weekId не порождает результат", () => {
    const prev: PlayerState = { ...base, weekId: 0, weekStartStack: 0 };
    expect(closedWeekOf(prev, { ...prev, weekId: 101, weekStartStack: 300 })).toBeNull();
  });

  /** Рейд мог срезать стек уже после фиксации базы — отрицательного прироста не бывает. */
  it("прирост не уходит в минус", () => {
    const prev: PlayerState = { ...base, weekId: 100, weekStartStack: 1_000 };
    const next: PlayerState = { ...prev, weekId: 101, weekStartStack: 900 };
    expect(closedWeekOf(prev, next)!.gain).toBe(0);
  });
});

/**
 * ГЛАВНАЯ РЕГРЕССИЯ. До этой правки результат недели существовал только как разность
 * `stack - weekStartStack`, а базу перезаписывал `settle` при первом же обращении игрока
 * после субботней полуночи. То есть список победителей исчезал ровно в момент сброса —
 * именно тогда, когда по нему надо платить реальные токены.
 *
 * Проверяем сквозь настоящий `settle`, а не на выдуманных стейтах: тест, который сам
 * строит входные данные, проверяет себя, а не продукт (NOTES.md 2026-07-25).
 */
describe("результат недели переживает сброс борда", () => {
  it("прирост зафиксирован в момент перехода и не зависит от того, что дальше", () => {
    const week = weekInfo(NOW);
    // Игрок кранкнул за час до субботней полуночи и больше не возвращался.
    const crankAt = week.endsAt - 3_600_000;
    const before: PlayerState = {
      ...initialState(crankAt),
      machineOn: true,
      streak: 1,
      stack: 0,
      lastCrankAt: crankAt,
      lastSettleAt: crankAt,
    };

    // Заходит уже на следующей неделе — settle переводит его через границу.
    const afterReset = week.endsAt + 5 * 3_600_000;
    const after = settle(before, afterReset).state;

    const closed = closedWeekOf(before, after);
    expect(closed).not.toBeNull();
    expect(closed!.weekId).toBe(week.weekId);

    // За час до полуночи машина капала по ставке стрика 1 — это и есть зачёт прошлой недели.
    const expected = GAME.BASE_RATE_PER_SEC * (1 + GAME.STREAK_STEP) * 3600;
    expect(closed!.gain).toBeCloseTo(expected, 6);

    // А в самом стейте прошлой недели уже нет: база перезаписана моментом границы, и
    // всё, что стейт теперь показывает, — зачёт НОВОЙ недели (машина работала ещё 5 часов
    // после сброса). Отсюда и берётся необходимость фиксировать результат отдельно.
    const newWeekGain = after.stack - after.weekStartStack;
    expect(newWeekGain).toBeCloseTo(
      GAME.BASE_RATE_PER_SEC * (1 + GAME.STREAK_STEP) * 5 * 3600,
      6,
    );
    expect(newWeekGain).not.toBeCloseTo(closed!.gain, 6);
  });
});

describe("isPayoutEligible", () => {
  it("кошелёк — да, анонимная сессия и бот — нет", () => {
    expect(isPayoutEligible(W(1))).toBe(true);
    expect(isPayoutEligible("dev:2f0c-uuid")).toBe(false);
    expect(isPayoutEligible("bot:slim-pete")).toBe(false);
  });

  it("кошелёк команды исключается: на сайте написано «nothing goes to the team»", () => {
    const excluded = new Set([W(1).slice("wallet:".length)]);
    expect(isPayoutEligible(W(1), excluded)).toBe(false);
    expect(isPayoutEligible(W(2), excluded)).toBe(true);
  });

  it("битый адрес в идентичности не даёт права на выплату", () => {
    expect(isPayoutEligible("wallet:0xnope")).toBe(false);
    expect(addressOf("wallet:0xnope")).toBeNull();
  });
});

describe("finalizeWeek", () => {
  const entry = (identity: string, gain: number) => ({ identity, gain });

  it("места идут по приросту, аноним место ЗАНИМАЕТ (правило 2026-07-28)", () => {
    const records = finalizeWeekWithShares(100, [
      entry("dev:anon", 5_000), // выше всех в зачёте — значит и место первое
      entry(W(1), 900),
      entry(W(2), 400),
    ]);

    const anon = records.find((r) => r.identity === "dev:anon")!;
    expect(anon.rank).toBe(1);
    expect(anon.eligible).toBe(false);
    // Доля у места есть, но выплате она не подлежит — сгорает.
    expect(anon.share).toBeCloseTo(10 / 55, 12);
    expect(records.find((r) => r.identity === W(1))!.rank).toBe(2);
    expect(records.find((r) => r.identity === W(2))!.rank).toBe(3);
  });

  it("доли НЕ перенормируются: процент на сайте и есть выплаченный", () => {
    const records = finalizeWeekWithShares(100, [entry(W(1), 300), entry(W(2), 200)]);
    // Раньше при двух местах было 2/3 и 1/3. Теперь кривая из десяти мест фиксирована:
    // первое всегда 18.2%, второе — 16.4%, сколько бы игроков ни пришло.
    expect(records[0].share).toBeCloseTo(10 / 55, 12);
    expect(records[1].share).toBeCloseTo(9 / 55, 12);
    const sum = records.reduce((s, r) => s + r.share, 0);
    expect(sum).toBeLessThan(1);
  });

  it("сгоревшая доля: непривязанные места и незанятые места никому не достаются", () => {
    const records = finalizeWeekWithShares(100, [
      entry("dev:anon", 5_000), // место 1 — сгорает
      entry(W(1), 900), // место 2 — выплачивается
    ]);
    // Выплачено только 9/55; остальное — доля анонима плюс восемь незанятых мест.
    expect(forfeitedShare(records)).toBeCloseTo(1 - 9 / 55, 12);
  });

  it("кошелёк команды места не занимает — иначе команда сжигала бы долю за игроков", () => {
    const team = W(9);
    const excluded = new Set([team.slice("wallet:".length).toLowerCase()]);
    const records = finalizeWeekWithShares(
      100,
      [entry(team, 9_000), entry(W(1), 100)],
      excluded,
    );
    expect(records.find((r) => r.identity === team)!.rank).toBeNull();
    expect(records.find((r) => r.identity === W(1))!.rank).toBe(1);
  });

  it("бот места не занимает: борд делит реальные токены", () => {
    const records = finalizeWeekWithShares(100, [entry("bot:seed", 9_000), entry(W(1), 100)]);
    expect(records.find((r) => r.identity === "bot:seed")!.rank).toBeNull();
    expect(records.find((r) => r.identity === W(1))!.rank).toBe(1);
  });

  it("полная десятка: первое место 18.2%, десятое 1.8%", () => {
    const records = finalizeWeekWithShares(
      100,
      Array.from({ length: 12 }, (_, i) => entry(W(i + 1), 1_000 - i)),
    );
    const seats = records.filter((r) => r.rank !== null);
    expect(seats).toHaveLength(PAYOUT_SEATS);
    expect(seats[0].share).toBeCloseTo(10 / 55, 12);
    expect(seats[9].share).toBeCloseTo(1 / 55, 12);
    expect(records.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 12);
  });

  it("нулевой прирост места не занимает", () => {
    const records = finalizeWeekWithShares(100, [entry(W(1), 0), entry(W(2), 5)]);
    expect(records.find((r) => r.identity === W(1))!.rank).toBeNull();
    expect(records.find((r) => r.identity === W(2))!.rank).toBe(1);
  });

  it("адрес и eligible проставлены — по ним делается ручная выплата", () => {
    const [r] = finalizeWeekWithShares(100, [entry(W(7), 10)]);
    expect(r.address).toBe(W(7).slice("wallet:".length));
    expect(r.eligible).toBe(true);
    expect(r.payoutTx).toBeNull(); // хеш вписывается вручную после отправки токенов
  });
});

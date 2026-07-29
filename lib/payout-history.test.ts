import { describe, it, expect } from "vitest";
import type { PlayerState } from "./game";
import type { WeekResultRecord } from "./week-results";
import { toPayoutRows, toPayoutWeek } from "./payout-history";

const ADDR_A = "0x281e57cdab271de434aed2100cb125f5df1018db";
const ADDR_B = "0x4cAec139dfC936a2043FE3035B0d0D59ba877613";

function state(patch: Partial<PlayerState> = {}): PlayerState {
  return {
    stack: 0,
    streak: 0,
    lastCrankAt: null,
    lastSettleAt: 0,
    machineOn: false,
    boostTier: 0,
    boostPpb: 0,
    weekId: 2951,
    weekStartStack: 0,
    nickname: null,
    hideWallet: false,
    ...patch,
  };
}

function rec(patch: Partial<WeekResultRecord> = {}): WeekResultRecord {
  return {
    weekId: 2951,
    identity: `wallet:${ADDR_A}`,
    address: ADDR_A,
    gain: 100,
    rank: 1,
    eligible: true,
    share: 0.5,
    payoutTx: null,
    ...patch,
  };
}

describe("приватность — главный риск этой страницы", () => {
  it("internal id не утекает ни в одно поле строки", () => {
    const rows = toPayoutRows(
      [
        rec({ identity: `wallet:${ADDR_A}` }),
        rec({ identity: "dev:1f2e3d4c-aaaa-bbbb", address: null, rank: null, share: 0 }),
        rec({ identity: "bot:tester", address: null, rank: null, share: 0 }),
      ],
      new Map(),
    );
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("wallet:");
    expect(dump).not.toContain("dev:");
    expect(dump).not.toContain("bot:");
  });

  it("скрывший адрес: адрес наружу не идёт, но строка остаётся и остаётся eligible", () => {
    const id = `wallet:${ADDR_A}`;
    const rows = toPayoutRows(
      [rec({ identity: id })],
      new Map([[id, state({ hideWallet: true })]]),
    );
    expect(rows[0].address).toBeNull();
    expect(rows[0].label).toBe("anon");
    expect(rows[0].eligible).toBe(true);
    expect(rows[0].rank).toBe(1);
  });

  it("скрывший адрес, но с ником — показываем ник, адрес всё равно не отдаём", () => {
    const id = `wallet:${ADDR_A}`;
    const rows = toPayoutRows(
      [rec({ identity: id })],
      new Map([[id, state({ hideWallet: true, nickname: "hello" })]]),
    );
    expect(rows[0].label).toBe("hello");
    expect(rows[0].address).toBeNull();
  });
});

describe("ярлыки", () => {
  it("ник важнее короткого адреса", () => {
    const id = `wallet:${ADDR_A}`;
    const rows = toPayoutRows([rec({ identity: id })], new Map([[id, state({ nickname: "hello" })]]));
    expect(rows[0].label).toBe("hello");
    expect(rows[0].address).toBe(ADDR_A);
  });

  it("игрока нет в снапшоте — деградируем до короткого адреса, а не до пустой строки", () => {
    const rows = toPayoutRows([rec()], new Map());
    expect(rows[0].label).toBe("0x281e…18db");
    expect(rows[0].address).toBe(ADDR_A);
  });

  it("без адреса и без ника — anon", () => {
    const rows = toPayoutRows(
      [rec({ identity: "dev:x", address: null, rank: null, share: 0, eligible: false })],
      new Map(),
    );
    expect(rows[0].label).toBe("anon");
    expect(rows[0].address).toBeNull();
  });
});

describe("порядок строк не должен противоречить борду", () => {
  it("места в деньгах идут первыми по возрастанию ранга, остальные — по убыванию прироста", () => {
    const rows = toPayoutRows(
      [
        rec({ identity: "dev:big", address: null, rank: null, share: 0, gain: 900, eligible: false }),
        rec({ identity: `wallet:${ADDR_B}`, address: ADDR_B, rank: 2, share: 0.33, gain: 200 }),
        rec({ identity: "dev:small", address: null, rank: null, share: 0, gain: 50, eligible: false }),
        rec({ identity: `wallet:${ADDR_A}`, address: ADDR_A, rank: 1, share: 0.5, gain: 100 }),
      ],
      new Map(),
    );
    expect(rows.map((r) => r.rank)).toEqual([1, 2, null, null]);
    // Аноним с приростом 900 стоит выше первого места по цифре, но места в деньгах не
    // занимает — это и есть правило eligibility, и страница обязана его отражать.
    expect(rows[2].gain).toBe(900);
    expect(rows[3].gain).toBe(50);
  });
});

describe("свод недели", () => {
  it("считает занятые места и сколько из них подтверждены хешем", () => {
    const w = toPayoutWeek(
      2951,
      [
        rec({ identity: "a", address: ADDR_A, rank: 1, share: 0.5, payoutTx: "0xabc" }),
        rec({ identity: "b", address: ADDR_B, rank: 2, share: 0.33, payoutTx: null }),
        rec({ identity: "c", address: null, rank: null, share: 0, eligible: false }),
      ],
      new Map(),
    );
    expect(w.weekId).toBe(2951);
    expect(w.paidSeats).toBe(2);
    expect(w.paidTxCount).toBe(1);
    expect(w.rows).toHaveLength(3);
  });

  it("пустая строка хеша не считается выплатой", () => {
    const w = toPayoutWeek(2951, [rec({ payoutTx: "" })], new Map());
    expect(w.paidSeats).toBe(1);
    expect(w.paidTxCount).toBe(0);
  });

  it("доля переводится в проценты с одним знаком, как на сайте", () => {
    const w = toPayoutWeek(2951, [rec({ share: 0.182 })], new Map());
    expect(w.rows[0].sharePct).toBe(18.2);
  });
});

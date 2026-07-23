import { describe, it, expect } from "vitest";
import { buildLeaderboard, weekInfo } from "./leaderboard";
import { initialState, type PlayerState } from "./game";
import type { PlayerSnapshot } from "./store";

const NOW = 1_760_000_000_000;

function off(stack: number): PlayerState {
  return { ...initialState(NOW), stack };
}

describe("weekInfo", () => {
  it("endsInMs в пределах недели и убывает со временем", () => {
    const a = weekInfo(NOW);
    expect(a.endsInMs).toBeGreaterThan(0);
    expect(a.endsInMs).toBeLessThanOrEqual(7 * 24 * 3600 * 1000);
    const b = weekInfo(NOW + 3600_000);
    expect(b.endsInMs).toBeLessThan(a.endsInMs);
  });
});

describe("buildLeaderboard", () => {
  const snap: PlayerSnapshot[] = [
    { identity: "wallet:0xabc0000000000000000000000000000000000001", state: off(100) },
    { identity: "dev:whale", state: off(200) },
    { identity: "dev:me", state: off(50) },
  ];

  it("ранжирует по стеку по убыванию", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    expect(lb.top.map((r) => r.stack)).toEqual([200, 100, 50]);
    expect(lb.top[0].rank).toBe(1);
  });

  it("общий сейф = сумма стеков", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    expect(lb.communalVault).toBe(350);
    expect(lb.players).toBe(3);
  });

  it("приватность: кошелёк = короткий адрес, dev = anon", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    const wallet = lb.top.find((r) => r.kind === "wallet")!;
    expect(wallet.label).toMatch(/^0x.{4}….{4}$/);
    expect(lb.top.filter((r) => r.kind === "anon").every((r) => r.label === "anon")).toBe(true);
  });

  it("отмечает «you» и отдаёт ранг игрока", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    expect(lb.top.find((r) => r.isYou)?.stack).toBe(50);
    expect(lb.you).toEqual({ rank: 3, stack: 50 });
  });

  it("живой стек: заводящийся игрок докапывается на момент запроса", () => {
    const winding: PlayerState = {
      ...initialState(NOW),
      machineOn: true,
      streak: 1,
      stack: 0,
      lastCrankAt: NOW - 10_000, // 10с назад, внутри окна завода
      lastSettleAt: NOW - 10_000,
    };
    const lb = buildLeaderboard([{ identity: "dev:me", state: winding }], NOW, "dev:me");
    expect(lb.top[0].stack).toBeGreaterThan(0); // settle начислил за 10с
  });
});

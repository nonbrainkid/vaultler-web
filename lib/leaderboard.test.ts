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

  it("приватность: кошелёк = короткий адрес + полный адрес, dev = anon без адреса", () => {
    const lb = buildLeaderboard(snap, NOW, "dev:me");
    const wallet = lb.top.find((r) => r.kind === "wallet")!;
    expect(wallet.label).toMatch(/^0x.{4}….{4}$/);
    expect(wallet.address).toMatch(/^0x[0-9a-fA-F]{40}$/); // адрес открыт по умолчанию
    const anon = lb.top.find((r) => r.kind === "anon")!;
    expect(anon.label).toBe("anon");
    expect(anon.address).toBeNull();
  });

  it("ник кошелька показывается вместо адреса, но адрес всё равно доступен", () => {
    const withNick: PlayerSnapshot[] = [
      {
        identity: "wallet:0xabc0000000000000000000000000000000000001",
        state: { ...off(100), nickname: "SlimPete" },
      },
    ];
    const lb = buildLeaderboard(withNick, NOW, "x");
    expect(lb.top[0].label).toBe("SlimPete");
    expect(lb.top[0].address).not.toBeNull(); // для explorer-ссылки
  });

  it("скрытый кошелёк не отдаёт адрес наружу", () => {
    const hidden: PlayerSnapshot[] = [
      {
        identity: "wallet:0xabc0000000000000000000000000000000000002",
        state: { ...off(100), nickname: "Ghost", hideWallet: true },
      },
      {
        identity: "wallet:0xabc0000000000000000000000000000000000003",
        state: { ...off(50), hideWallet: true }, // скрыт, без ника
      },
    ];
    const lb = buildLeaderboard(hidden, NOW, "x");
    expect(lb.top[0].label).toBe("Ghost");
    expect(lb.top[0].address).toBeNull(); // адрес НЕ уходит
    expect(lb.top[1].label).toBe("anon"); // скрыт без ника → anon
    expect(lb.top[1].address).toBeNull();
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

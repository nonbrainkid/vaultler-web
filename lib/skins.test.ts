import { describe, it, expect } from "vitest";
import { rankLevel, isSkinUnlocked, nextSkin, RANK_SKINS } from "./skins";

// Уровни: 0 base · 1 top1000 · 2 top500 · 3 top100 · 4 top10 · 5 #1

describe("разблокировка скинов по размеру комьюнити", () => {
  it("«TOP N» открыт только когда игроков БОЛЬШЕ N", () => {
    expect(isSkinUnlocked(4, 10)).toBe(false); // ровно 10 — топ-10 это все
    expect(isSkinUnlocked(4, 11)).toBe(true);
    expect(isSkinUnlocked(3, 100)).toBe(false);
    expect(isSkinUnlocked(3, 101)).toBe(true);
  });

  it("базовый скин доступен всегда", () => {
    expect(isSkinUnlocked(0, 0)).toBe(true);
  });
});

describe("rankLevel", () => {
  it("без ранга — базовый сейф", () => {
    expect(rankLevel(null, 5000)).toBe(0);
    expect(rankLevel(undefined, 5000)).toBe(0);
  });

  it("при 100 участниках работают только топ-10 и топ-1 (кейс Егора)", () => {
    expect(rankLevel(1, 100)).toBe(5); // #1
    expect(rankLevel(7, 100)).toBe(4); // топ-10
    expect(rankLevel(50, 100)).toBe(0); // топ-100 = все → скина нет
    expect(rankLevel(99, 100)).toBe(0);
  });

  it("при 500 участниках открывается топ-100, но не топ-500", () => {
    expect(rankLevel(50, 500)).toBe(3); // топ-100 заработал
    expect(rankLevel(300, 500)).toBe(0); // топ-500 = все → скина нет
    expect(rankLevel(5, 500)).toBe(4);
  });

  it("при 1001 участнике открывается и топ-1000", () => {
    expect(rankLevel(800, 1001)).toBe(1);
    expect(rankLevel(400, 1001)).toBe(2);
    expect(rankLevel(60, 1001)).toBe(3);
  });

  it("на старте с горсткой игроков короны не раздаются", () => {
    // 3 игрока: второе место НЕ даёт «топ-10», иначе скин обесценится
    expect(rankLevel(2, 3)).toBe(0);
    expect(rankLevel(3, 3)).toBe(0);
    // но первое место — всегда первое место
    expect(rankLevel(1, 3)).toBe(5);
  });

  it("выдаёт самый высокий подходящий и уже открытый скин", () => {
    // рейтинг 1 при большом комьюнити — всё равно #1, а не топ-10
    expect(rankLevel(1, 5000)).toBe(5);
    expect(rankLevel(10, 5000)).toBe(4);
    expect(rankLevel(11, 5000)).toBe(3);
  });
});

describe("nextSkin", () => {
  it("ведёт к ближайшей ДОСТИЖИМОЙ ступени, а не просто к следующей по списку", () => {
    // 3 игрока: топ-1000/500/100/10 закрыты, реально достижим только «#1»
    const g = nextSkin(0, 3);
    expect(g?.label).toBe(RANK_SKINS[5].label);
    expect(g?.unlocked).toBe(true);
  });

  it("при большом комьюнити следующая ступень — соседняя", () => {
    expect(nextSkin(0, 5000)?.label).toBe(RANK_SKINS[1].label);
    expect(nextSkin(4, 5000)?.label).toBe(RANK_SKINS[5].label);
  });

  it("если выше ничего не открыто — показывает ту, что откроется раньше всех", () => {
    const g = nextSkin(0, 1); // не открыт даже «#1» (нужно >1)
    expect(g?.unlocked).toBe(false);
    expect(g?.unlockAt).toBe(1); // «#1» откроется первым — при 2 игроках
  });

  it("на вершине следующей ступени нет", () => {
    expect(nextSkin(5, 5000)).toBeNull();
  });
});

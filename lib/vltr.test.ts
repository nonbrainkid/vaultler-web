import { describe, it, expect } from "vitest";
import { parseUnits } from "viem";
import { meetsBoostThreshold, rawForPpb, shareInPpb } from "./vltr";
import { HOLDER_TIERS, holderTierFromPpb, MAX_HOLDER_LEVEL } from "./game";

// Анти-дуст-порог: страхует вырожденную конфигурацию токена. Проверяем именно границу.
describe("порог буста", () => {
  it("ровно порог — буст есть (граница включительно)", () => {
    expect(meetsBoostThreshold(parseUnits("1", 18), 18, "1")).toBe(true);
  });

  it("на один вэй меньше порога — буста нет", () => {
    expect(meetsBoostThreshold(parseUnits("1", 18) - 1n, 18, "1")).toBe(false);
  });

  it("пустой баланс — буста нет", () => {
    expect(meetsBoostThreshold(0n, 18, "1")).toBe(false);
  });

  it("учитывает decimals токена, а не только число", () => {
    // 1 токен при 6 decimals — это 1_000_000 единиц, а не 1e18.
    expect(meetsBoostThreshold(1_000_000n, 6, "1")).toBe(true);
    expect(meetsBoostThreshold(999_999n, 6, "1")).toBe(false);
  });

  it("дробный порог поддерживается", () => {
    expect(meetsBoostThreshold(parseUnits("0.5", 18), 18, "0.5")).toBe(true);
    expect(meetsBoostThreshold(parseUnits("0.49", 18), 18, "0.5")).toBe(false);
  });

  /**
   * Регрессия: раньше баланс переводился в Number (raw / 10**decimals). При 18 decimals
   * Number точен лишь до ~9e15 единиц, то есть до сотых долей токена, — сравнение
   * у крупных холдеров становилось приблизительным. В bigint разница в один вэй видна.
   */
  it("не теряет точность на больших балансах", () => {
    const min = "1000000000"; // миллиард токенов
    const exact = parseUnits(min, 18);
    expect(meetsBoostThreshold(exact, 18, min)).toBe(true);
    expect(meetsBoostThreshold(exact - 1n, 18, min)).toBe(false);
  });

  it("огромный баланс не ломает сравнение", () => {
    expect(meetsBoostThreshold(parseUnits("1000000000000", 18), 18, "1")).toBe(true);
  });
});

/**
 * Доля в эмиссии — знаменатель всей лестницы тиров. Считается целиком в bigint:
 * Number терял бы точность на балансах крупных холдеров, а от этой величины зависит
 * множитель, определяющий, кто попадёт в топ-10 и разделит призовой пул.
 */
describe("доля в эмиссии (ppb)", () => {
  const SUPPLY = parseUnits("1000000000", 18); // 1 млрд токенов, 18 decimals

  it("считает долю независимо от decimals — они сокращаются", () => {
    expect(shareInPpb(SUPPLY, SUPPLY)).toBe(1e9); // 100%
    expect(shareInPpb(SUPPLY / 2n, SUPPLY)).toBe(5e8); // 50%
    expect(shareInPpb(SUPPLY / 1000n, SUPPLY)).toBe(1e6); // 0.1%
    expect(shareInPpb(parseUnits("1000000", 6), parseUnits("1000000000", 6))).toBe(1e6);
  });

  it("нулевой баланс и нулевая эмиссия не роняют счёт", () => {
    expect(shareInPpb(0n, SUPPLY)).toBe(0);
    expect(shareInPpb(parseUnits("1", 18), 0n)).toBe(0);
    expect(shareInPpb(0n, 0n)).toBe(0);
  });

  it("не теряет точность на балансе кита", () => {
    // 0.5% эмиссии — ровно вершина лестницы; на один вэй меньше уже нет.
    const exact = rawForPpb(HOLDER_TIERS[MAX_HOLDER_LEVEL].minPpb, SUPPLY);
    expect(holderTierFromPpb(shareInPpb(exact, SUPPLY))).toBe(MAX_HOLDER_LEVEL);
    expect(holderTierFromPpb(shareInPpb(exact - 1n, SUPPLY))).toBe(MAX_HOLDER_LEVEL - 1);
  });

  it("порог каждой ступени переводится в токены и обратно без сдвига границы", () => {
    for (const t of HOLDER_TIERS.slice(1)) {
      const need = rawForPpb(t.minPpb, SUPPLY);
      expect(holderTierFromPpb(shareInPpb(need, SUPPLY))).toBe(t.level);
      expect(holderTierFromPpb(shareInPpb(need - 1n, SUPPLY))).toBe(t.level - 1);
    }
  });

  it("сколько токенов нужно на ступень — считается от эмиссии", () => {
    // 0.001% от 1 млрд = 10 000 токенов.
    expect(rawForPpb(10_000, SUPPLY)).toBe(parseUnits("10000", 18));
    // 0.5% от 1 млрд = 5 млн токенов.
    expect(rawForPpb(5_000_000, SUPPLY)).toBe(parseUnits("5000000", 18));
    expect(rawForPpb(0, SUPPLY)).toBe(0n);
    expect(rawForPpb(10_000, 0n)).toBe(0n);
  });

  /**
   * Лестница самокалибруется: та же ступень при вдвое большей эмиссии требует вдвое
   * больше токенов. Именно поэтому порог задан долей, а не числом токенов — иначе его
   * пришлось бы вручную догонять после каждого изменения эмиссии.
   */
  it("вдвое большая эмиссия — вдвое дороже ступень", () => {
    const one = rawForPpb(HOLDER_TIERS[2].minPpb, SUPPLY);
    const twice = rawForPpb(HOLDER_TIERS[2].minPpb, SUPPLY * 2n);
    expect(twice).toBe(one * 2n);
  });
});

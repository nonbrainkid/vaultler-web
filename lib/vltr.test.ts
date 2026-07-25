import { describe, it, expect } from "vitest";
import { parseUnits } from "viem";
import { meetsBoostThreshold } from "./vltr";

// Порог решает, получит игрок ×5 или нет, поэтому проверяем именно границу.
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

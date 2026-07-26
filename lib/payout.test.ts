import { describe, it, expect } from "vitest";
import { PAYOUT_SEATS, PAYOUT_SHARES, payoutShare, payoutSharePct } from "./payout";

/**
 * Кривая выплат — это реальные токены. Проверяем не «примерно похоже», а три свойства,
 * на которых держится обещание игроку: доли складываются в целый пул, кривая монотонна,
 * и опубликованные на сайте проценты совпадают с формулой из docs/roadmap.md.
 */
describe("дележ пула", () => {
  it("доли всех десяти мест дают ровно 100% пула", () => {
    const sum = PAYOUT_SHARES.map((_, i) => payoutShare(i + 1)).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
  });

  it("совпадает с опубликованной таблицей", () => {
    const published = [18.2, 16.4, 14.5, 12.7, 10.9, 9.1, 7.3, 5.5, 3.6, 1.8];
    expect(published.map((_, i) => payoutSharePct(i + 1))).toEqual(published);
  });

  it("формула (11 − N) / 55 воспроизводится в лоб", () => {
    for (let n = 1; n <= PAYOUT_SEATS; n++) {
      expect(payoutShare(n)).toBeCloseTo((11 - n) / 55, 12);
    }
  });

  it("кривая строго убывает — за каждое место выше стоит бороться", () => {
    for (let n = 2; n <= PAYOUT_SEATS; n++) {
      expect(payoutShare(n)).toBeLessThan(payoutShare(n - 1));
    }
  });

  /**
   * Первое место должно быть заметно дороже последнего, но не настолько, чтобы места
   * 6–10 обесценились: иначе «десять мест оплачиваются» — обман.
   */
  it("разрыв между первым и десятым местом ровно десятикратный", () => {
    expect(payoutShare(1) / payoutShare(PAYOUT_SEATS)).toBeCloseTo(10, 12);
    // нижняя половина борда всё ещё получает существенную часть пула
    const bottomHalf = [6, 7, 8, 9, 10].reduce((a, n) => a + payoutShare(n), 0);
    expect(bottomHalf).toBeGreaterThan(0.25);
  });

  it("при неполном борде веса перенормируются на фактические места", () => {
    for (const seats of [1, 3, 7]) {
      const sum = Array.from({ length: seats }, (_, i) => payoutShare(i + 1, seats)).reduce(
        (a, b) => a + b,
        0,
      );
      expect(sum).toBeCloseTo(1, 12); // пул делится целиком, «ничьей» доли не остаётся
    }
    expect(payoutShare(1, 1)).toBe(1); // один игрок забирает весь пул
    expect(payoutShare(2, 3)).toBeCloseTo(2 / 6, 12);
  });

  it("мусор и места вне борда получают ноль, а не ошибку", () => {
    expect(payoutShare(0)).toBe(0);
    expect(payoutShare(11)).toBe(0);
    expect(payoutShare(-1)).toBe(0);
    expect(payoutShare(NaN)).toBe(0);
    expect(payoutShare(4, 3)).toBe(0); // места 4 при трёх игроках не существует
  });
});

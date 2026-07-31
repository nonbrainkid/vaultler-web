/**
 * Тесты чистой логики встроенного обмена.
 *
 * Что здесь на самом деле проверяется: что ни одно денежное число нельзя подсунуть снаружи
 * и что подменённая или пустая квота не доходит до подписи. Расчёты идут в bigint, потому
 * что на 18 decimals `Number` теряет точность уже на десятых долях токена.
 */
import { describe, expect, it } from "vitest";
import {
  ALLOWED_SLIPPAGE_BPS,
  DEFAULT_SLIPPAGE_BPS,
  SWAP_FEE_BPS,
  TOTAL_FEE_BPS,
  WARN_IMPACT_BPS,
  ZEROX_FEE_BPS,
  bpsToPercent,
  checkQuote,
  computeImpactBps,
  feeAmount,
  impactVerdict,
  normalizeSlippageBps,
  parseAmount,
  referenceProbeAmount,
  spenderFromQuote,
} from "./swap";

const ONE_WETH = 10n ** 18n;

describe("ставка фиса", () => {
  it("наша ставка — 1.15%, итог с роутером 1.30% (решение владельца 30.07)", () => {
    expect(SWAP_FEE_BPS).toBe(115);
    expect(ZEROX_FEE_BPS).toBe(15);
    expect(TOTAL_FEE_BPS).toBe(130);
  });

  it("процент для UI выводится из той же константы, а не пишется руками", () => {
    expect(bpsToPercent(SWAP_FEE_BPS)).toBe("1.15");
    expect(bpsToPercent(TOTAL_FEE_BPS)).toBe("1.3");
    expect(bpsToPercent(0)).toBe("0");
  });
});

describe("feeAmount", () => {
  it("считает 1.15% от суммы в наименьших единицах", () => {
    // 1 WETH → 0.0115 WETH
    expect(feeAmount(ONE_WETH)).toBe(11_500_000_000_000_000n);
  });

  it("сходится с живой квотой 0x (0.01 WETH при 50 bps → 0.00005 WETH)", () => {
    // Значение снято с реального ответа API 30.07 — тест ловит расхождение с провайдером.
    expect(feeAmount(10_000_000_000_000_000n, 50)).toBe(50_000_000_000_000n);
  });

  it("не теряет точность там, где её потерял бы Number", () => {
    // 1 wei меньше, чем шаг double на этих величинах: считаем ровно.
    const almost = ONE_WETH * 1_000_000n + 1n;
    expect(feeAmount(almost)).toBe((almost * 115n) / 10_000n);
  });

  it("округляет вниз — неделимый остаток остаётся игроку", () => {
    expect(feeAmount(1n)).toBe(0n);
    expect(feeAmount(86n)).toBe(0n); // 86 * 115 / 10000 = 0.989 → 0
    expect(feeAmount(87n)).toBe(1n);
  });

  it("на нуле и мусорной сумме даёт ноль, а не отрицательный фис", () => {
    expect(feeAmount(0n)).toBe(0n);
    expect(feeAmount(-100n)).toBe(0n);
  });

  it("отказывается считать по отрицательной или дробной ставке", () => {
    expect(() => feeAmount(ONE_WETH, -1)).toThrow();
    expect(() => feeAmount(ONE_WETH, 1.5)).toThrow();
  });
});

describe("parseAmount", () => {
  it("разбирает десятичную запись в единицы токена", () => {
    expect(parseAmount("1", 18)).toBe(ONE_WETH);
    expect(parseAmount("0.001", 18)).toBe(10n ** 15n);
    expect(parseAmount(" 0.5 ", 18)).toBe(5n * 10n ** 17n);
  });

  it("отклоняет всё, что не сумма", () => {
    for (const bad of ["", "abc", "-1", "1e18", "1,5", "0x10", "1.2.3", "."]) {
      expect(parseAmount(bad, 18), bad).toBeNull();
    }
  });

  it("отклоняет ноль: обмен на нулевую сумму — это не сделка, а лишний запрос к 0x", () => {
    expect(parseAmount("0", 18)).toBeNull();
    expect(parseAmount("0.0", 18)).toBeNull();
  });

  it("отклоняет больше разрядов, чем есть у токена", () => {
    expect(parseAmount("0.1234567890123456789", 18)).toBeNull();
    expect(parseAmount("0.123456", 6)).toBe(123_456n);
    expect(parseAmount("0.1234567", 6)).toBeNull();
  });
});

describe("normalizeSlippageBps", () => {
  it("пропускает только значения из белого списка", () => {
    for (const ok of ALLOWED_SLIPPAGE_BPS) expect(normalizeSlippageBps(ok)).toBe(ok);
  });

  it("любое чужое значение схлопывает в дефолт", () => {
    // Произвольный slippage из браузера = обмен по любой цене, то есть подарок
    // сэндвич-боту за счёт игрока.
    for (const bad of [9999, 10000, -100, 0, 1.5, "500", null, undefined, {}]) {
      expect(normalizeSlippageBps(bad)).toBe(DEFAULT_SLIPPAGE_BPS);
    }
  });
});

describe("checkQuote", () => {
  const good = (sellAmount: bigint) => ({
    liquidityAvailable: true,
    sellAmount: sellAmount.toString(),
    buyAmount: "598518279019244895292379",
    fees: {
      integratorFee: { amount: feeAmount(sellAmount).toString(), token: "0xweth", type: "volume" },
      zeroExFee: { amount: "1500000000000", token: "0xweth", type: "volume" },
    },
  });

  it("принимает корректную квоту", () => {
    expect(checkQuote(good(ONE_WETH), ONE_WETH)).toEqual({ ok: true });
  });

  it("роняет квоту, если фис не наш — это либо баг параметров, либо подмена ответа", () => {
    const tampered = good(ONE_WETH);
    tampered.fees.integratorFee.amount = "1"; // «фис» на копейку вместо 1.15%
    expect(checkQuote(tampered, ONE_WETH)).toEqual({ ok: false, error: "fee_mismatch" });
  });

  it("роняет квоту без фиса вовсе", () => {
    const noFee = { ...good(ONE_WETH), fees: { integratorFee: null } };
    expect(checkQuote(noFee, ONE_WETH)).toEqual({ ok: false, error: "fee_mismatch" });
  });

  it("отдаёт no_route, когда маршрута нет или покупка нулевая", () => {
    expect(checkQuote({ ...good(ONE_WETH), liquidityAvailable: false }, ONE_WETH)).toEqual({
      ok: false,
      error: "no_route",
    });
    expect(checkQuote({ ...good(ONE_WETH), buyAmount: "0" }, ONE_WETH)).toEqual({
      ok: false,
      error: "no_route",
    });
  });

  it("ловит подмену суммы: продали больше, чем игрок согласился отдать", () => {
    expect(checkQuote(good(ONE_WETH * 2n), ONE_WETH)).toEqual({ ok: false, error: "bad_shape" });
  });

  it("не падает на мусоре вместо JSON", () => {
    for (const bad of [null, undefined, "quote", 42, []]) {
      expect(checkQuote(bad, ONE_WETH).ok).toBe(false);
    }
  });
});

describe("контроль проскальзывания цены", () => {
  // Числа взяты с живых квот 30.07: базовая ставка ~598.5M VLTR/WETH.
  const reference = { sellAmount: 10n ** 15n, buyAmount: 598_518_279_019_244_895_292_379n };

  it("на мелкой сделке impact близок к нулю", () => {
    const actual = { sellAmount: 10n ** 16n, buyAmount: 5_920_264_294_463_275_000_000_000n };
    expect(computeImpactBps(reference, actual)).toBeLessThan(WARN_IMPACT_BPS);
    expect(impactVerdict(computeImpactBps(reference, actual))).toBe("ok");
  });

  it("на 0.1 WETH даёт ~6% и требует предупреждения", () => {
    const actual = { sellAmount: 10n ** 17n, buyAmount: 55_915_273_634_351_090_000_000_000n };
    const impact = computeImpactBps(reference, actual);
    expect(impact).toBeGreaterThan(500);
    expect(impact).toBeLessThan(700);
    expect(impactVerdict(impact)).toBe("warn");
  });

  it("блокирует сделку, которую 0x считает исполнимой: 1000 WETH → потеря 99.85%", () => {
    // Регрессия на реальную находку: провайдер отдал liquidityAvailable: true на покупку
    // 1000 WETH в пул глубиной 0.14 WETH. slippageBps от этого не защищает.
    const actual = { sellAmount: 10n ** 21n, buyAmount: 904_901_366_000_000_000_000_000_000n };
    const impact = computeImpactBps(reference, actual);
    expect(impact).toBeGreaterThan(9_900);
    expect(impactVerdict(impact)).toBe("block");
  });

  it("блокирует и 1 WETH — там уже 40% потери", () => {
    const actual = { sellAmount: 10n ** 18n, buyAmount: 358_099_769_000_000_000_000_000_000n };
    expect(impactVerdict(computeImpactBps(reference, actual))).toBe("block");
  });

  it("не паникует на вырожденных данных", () => {
    expect(computeImpactBps({ sellAmount: 0n, buyAmount: 0n }, reference)).toBe(0);
    expect(computeImpactBps(reference, { sellAmount: 10n ** 18n, buyAmount: 0n })).toBe(10_000);
  });

  it("исполнение лучше эталона не превращается в отрицательный impact", () => {
    const better = { sellAmount: 10n ** 15n, buyAmount: reference.buyAmount + 1_000n };
    expect(computeImpactBps(reference, better)).toBe(0);
  });

  it("зонд для базовой цены — мелкий и зависит от направления", () => {
    expect(referenceProbeAmount("buy")).toBe(10n ** 15n);
    expect(referenceProbeAmount("sell")).toBe(10n ** 24n);
  });
});

describe("spenderFromQuote", () => {
  const allowanceHolder = "0x0000000000001fF3684f28c67538d4D072C22734";
  const settler = "0x1111111111111111111111111111111111111111";

  it("берёт спендера из issues.allowance", () => {
    expect(
      spenderFromQuote({ issues: { allowance: { spender: allowanceHolder } } }),
    ).toBe(allowanceHolder);
  });

  it("падает обратно на allowanceTarget", () => {
    expect(spenderFromQuote({ allowanceTarget: allowanceHolder })).toBe(allowanceHolder);
  });

  it("НИКОГДА не берёт transaction.to — Settler меняется от деплоя к деплою", () => {
    // Апрув на Settler = разрешение тратить токены адресу, который завтра другой.
    // Это главная ошибка интеграции 0x, поэтому она закрыта тестом, а не комментарием.
    expect(spenderFromQuote({ transaction: { to: settler }, issues: { allowance: null } })).toBeNull();
  });

  it("отклоняет мусор вместо адреса", () => {
    expect(spenderFromQuote({ allowanceTarget: "not-an-address" })).toBeNull();
    expect(spenderFromQuote(null)).toBeNull();
  });
});

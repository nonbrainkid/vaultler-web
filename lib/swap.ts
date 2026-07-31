/**
 * Встроенный обмен на сайте с интерфейсным фисом (docs/monetization.md, M1).
 *
 * Зачем вообще: кнопка BUY ведёт на лончпад, то есть весь интерфейсный доход с приведённого
 * нами покупателя достаётся ему. Обмен на своей странице оставляет этот доход проекту, при
 * этом средств мы не касаемся: квоту собирает 0x, транзакцию подписывает кошелёк игрока,
 * фис уходит на наш адрес внутри той же транзакции.
 *
 * Здесь — только чистая логика и константы (роут остаётся тонким, как и везде в проекте).
 * Главное правило модуля: НИ ОДНО денежное число не приходит от клиента. Клиент присылает
 * сумму и направление; ставку фиса, получателя и допустимый слippage задаёт сервер. Если бы
 * ставка и получатель приходили из браузера, любой поставил бы себе `swapFeeBps=0` или свой
 * адрес — это тот же инвариант, что «API не принимает от клиента ни стек, ни флаг буста».
 */
import { getAddress, isAddress } from "viem";
import { RPC_CONFIGURED, VLTR_ADDRESS, robinhoodChain } from "./chain";

/**
 * Наша ставка, решение владельца 2026-07-30 (NOTES.md). 115 bps = 1.15%.
 *
 * ОДНА константа и для запроса к 0x, и для показа в UI — по тому же требованию, что у
 * процентов дележа пула в `lib/payout.ts`: страница не может разойтись с тем, что реально
 * списывается. Разойдись эти два числа — на сайте с девизом «доказательство вместо
 * обещания» появилась бы скрытая комиссия.
 */
export const SWAP_FEE_BPS = 115;

/**
 * Фис самого 0x поверх нашего — 15 bps, измерено на живой квоте 30.07 (`zeroExFee`).
 * Ставится провайдером и от нас не зависит, но пользователь платит сумму обоих, поэтому
 * на кнопке показываем ИТОГ. Значение справочное: фактическое всегда берём из ответа API.
 */
export const ZEROX_FEE_BPS = 15;

/** Итоговая ставка для текста в UI: 1.15% наших + 0.15% роутера = 1.30%. */
export const TOTAL_FEE_BPS = SWAP_FEE_BPS + ZEROX_FEE_BPS;

/**
 * WETH на Robinhood Chain — вторая сторона пары VLTR/WETH (пул `0x1E8E…a920`, Uniswap v3).
 * Публичный факт сети, поэтому держим в коде, как chainId и адрес токена.
 */
export const WETH_ADDRESS = getAddress("0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");

/** База 0x Swap API. Ходим к ней ТОЛЬКО с сервера: ключ в браузере = выжженная квота. */
export const ZEROX_API_BASE = "https://api.0x.org/swap/allowance-holder";

/**
 * Слippage. Дефолт 1%, разрешённый максимум 5%.
 *
 * Почему это важно именно здесь: глубина пула на 30.07 — 0.1402 WETH на стороне, и покупка
 * на 0.1 WETH уезжает по цене на ~6%. То есть дефолтные 100 bps будут отклонять всё
 * крупнее ~0.015 WETH — это ожидаемое поведение, а не поломка, и UI обязан объяснить
 * игроку, что на крупную сумму дешевле идти на лончпад.
 *
 * Клиент может выбрать значение, но только из разрешённого набора и в пределах максимума:
 * произвольный slippage из браузера — это способ обменять по любой цене, то есть подарок
 * сэндвич-боту за наш счёт.
 */
export const DEFAULT_SLIPPAGE_BPS = 100;
export const MAX_SLIPPAGE_BPS = 500;
export const ALLOWED_SLIPPAGE_BPS = [50, 100, 300, 500] as const;

/**
 * Адрес, на который 0x отправляет наш фис. Пока из env: значение выдаёт владелец, и до тех
 * пор фича выключена целиком. Когда адрес появится, он переедет дефолтом в код — он
 * публичный факт (виден в calldata каждой сделки) и должен проходить ревью в git, а не
 * жить в поле панели, где опечатка отправляет доход в чужой кошелёк без диффа.
 */
const RAW_FEE_RECIPIENT = process.env.SWAP_FEE_RECIPIENT?.trim() ?? "";
export const SWAP_FEE_RECIPIENT: `0x${string}` | "" = isAddress(RAW_FEE_RECIPIENT, {
  strict: false,
})
  ? getAddress(RAW_FEE_RECIPIENT)
  : "";

/**
 * Фича за флагом, разом по всем условиям — как Telegram-бот.
 * Половинчато включённый обмен хуже выключенного: игрок дошёл бы до подписи и получил
 * отказ на последнем шаге, уже разрешив трату токенов.
 */
export const SWAP_CONFIGURED =
  Boolean(process.env.ZEROX_API_KEY?.trim()) &&
  SWAP_FEE_RECIPIENT.length > 0 &&
  VLTR_ADDRESS.length > 0 &&
  RPC_CONFIGURED;

/** Что показывает `/api/health`: диагностика «почему обмена нет» без чтения логов. */
export function swapHealth(): "on" | "off" | "misconfigured" {
  if (SWAP_CONFIGURED) return "on";
  const anything =
    Boolean(process.env.ZEROX_API_KEY?.trim()) || RAW_FEE_RECIPIENT.length > 0;
  // Что-то задано, но не всё — это опечатка в конфиге, а не «фича не нужна».
  return anything ? "misconfigured" : "off";
}

export type SwapDirection = "buy" | "sell";

/**
 * Размер фиса в наименьших единицах продаваемого токена.
 *
 * Считаем в bigint: на 18 decimals `Number` теряет точность уже на десятых долях токена
 * (эта же грабля была с порогом буста, решение 2026-07-25). Округление — вниз, в пользу
 * игрока: лишний неделимый остаток лучше оставить ему, чем взять себе.
 */
export function feeAmount(sellAmount: bigint, bps: number = SWAP_FEE_BPS): bigint {
  if (sellAmount <= 0n) return 0n;
  if (!Number.isInteger(bps) || bps < 0) throw new Error("bps must be a non-negative integer");
  return (sellAmount * BigInt(bps)) / 10_000n;
}

/** Человеческий процент для текста в UI: 115 → "1.15". */
export function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
}

/**
 * Разбор суммы, введённой в поле. Принимаем только десятичную запись без знака и без
 * экспоненты: `parseUnits` на мусоре бросает, а мы хотим внятный отказ, а не 500.
 * Возвращаем null на всё, что не сумма — включая ноль и переполнение по разрядам.
 */
export function parseAmount(input: string, decimals: number): bigint | null {
  const raw = input.trim();
  if (!/^\d{1,30}(\.\d{1,30})?$/.test(raw)) return null;

  const [whole, frac = ""] = raw.split(".");
  if (frac.length > decimals) return null; // больше разрядов, чем есть у токена

  const padded = frac.padEnd(decimals, "0");
  const value = BigInt(whole + padded);
  return value > 0n ? value : null;
}

/** Разрешённый слippage: чужое число из браузера не берём на слово. */
export function normalizeSlippageBps(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) return DEFAULT_SLIPPAGE_BPS;
  return (ALLOWED_SLIPPAGE_BPS as readonly number[]).includes(value)
    ? value
    : DEFAULT_SLIPPAGE_BPS;
}

/**
 * Пара токенов для направления. Фис ВСЕГДА берём в WETH: при покупке это `sellToken`, при
 * продаже — `buyToken`. Причина не в удобстве, а в экономике: забирая фис в $VLTR, мы копим
 * собственный неликвидный токен, и продать его можно только продавив свой же тонкий пул.
 */
export function tokensFor(direction: SwapDirection): {
  sellToken: `0x${string}`;
  buyToken: `0x${string}`;
  feeToken: `0x${string}`;
} {
  if (!VLTR_ADDRESS) throw new Error("VLTR address is not configured");
  return direction === "buy"
    ? { sellToken: WETH_ADDRESS, buyToken: VLTR_ADDRESS, feeToken: WETH_ADDRESS }
    : { sellToken: VLTR_ADDRESS, buyToken: WETH_ADDRESS, feeToken: WETH_ADDRESS };
}

/**
 * Параметры запроса к 0x. Собираются НА СЕРВЕРЕ целиком: клиент влияет только на сумму,
 * направление и слippage из белого списка.
 */
export function buildQuoteParams(args: {
  direction: SwapDirection;
  sellAmount: bigint;
  slippageBps: number;
  taker?: string;
}): URLSearchParams {
  const { sellToken, buyToken, feeToken } = tokensFor(args.direction);
  const params = new URLSearchParams({
    chainId: String(robinhoodChain.id),
    sellToken,
    buyToken,
    sellAmount: args.sellAmount.toString(),
    slippageBps: String(normalizeSlippageBps(args.slippageBps)),
    swapFeeRecipient: SWAP_FEE_RECIPIENT,
    swapFeeBps: String(SWAP_FEE_BPS),
    swapFeeToken: feeToken,
  });
  // taker нужен только для исполняемой квоты: без него 0x не собирает транзакцию.
  if (args.taker) params.set("taker", getAddress(args.taker));
  return params;
}

export type QuoteCheck =
  | { ok: true }
  | { ok: false; error: "no_route" | "fee_mismatch" | "bad_shape" };

/**
 * Проверка ответа 0x перед тем, как показать его игроку или дать на подпись.
 *
 * Мы не рисуем чужой JSON доверчиво. Если в ответе фис не наш — это либо баг в наших
 * параметрах, либо подменённый ответ; в обоих случаях правильная реакция — уронить квоту,
 * а не молча обменять с чужим получателем фиса.
 */
export function checkQuote(raw: unknown, expectedSellAmount: bigint): QuoteCheck {
  if (raw === null || typeof raw !== "object") return { ok: false, error: "bad_shape" };
  const q = raw as Record<string, unknown>;

  if (q.liquidityAvailable === false) return { ok: false, error: "no_route" };
  if (typeof q.sellAmount !== "string" || BigInt(q.sellAmount) !== expectedSellAmount) {
    return { ok: false, error: "bad_shape" };
  }
  if (typeof q.buyAmount !== "string" || BigInt(q.buyAmount) <= 0n) {
    return { ok: false, error: "no_route" };
  }

  const fees = (q.fees ?? {}) as Record<string, unknown>;
  const integrator = (fees.integratorFee ?? null) as Record<string, unknown> | null;
  if (!integrator || typeof integrator.amount !== "string") {
    return { ok: false, error: "fee_mismatch" };
  }
  // Сверяем ровно то, что заявили: 0x считает фис от sellAmount по нашему bps.
  if (BigInt(integrator.amount) !== feeAmount(expectedSellAmount)) {
    return { ok: false, error: "fee_mismatch" };
  }

  return { ok: true };
}

/**
 * Контроль проскальзывания цены — защита игрока, которой у провайдера НЕТ.
 *
 * Найдено e2e-проверкой 2026-07-30 (`scripts/test-swap.mjs`): 0x отдаёт
 * `liquidityAvailable: true` на покупку 1000 WETH в пул глубиной 0.14 WETH. Квота при этом
 * предлагает отдать 1000 WETH и получить весь пул — потеря ~99.85%. На 1 WETH потеря ~40%.
 *
 * Параметр `slippageBps` от этого не спасает: он сверяет исполнение с УЖЕ разорительной
 * котировкой, а не с рыночной ценой. Поэтому impact считаем сами и крупные сделки
 * блокируем. Для сайта, который учит «не трогай кошелёк», отдать такую квоту на подпись —
 * хуже, чем не иметь обмена вовсе.
 */
export const WARN_IMPACT_BPS = 300; // 3% — показываем предупреждение
export const MAX_IMPACT_BPS = 1_000; // 10% — отказываемся обменивать

/** Размер зонда для базовой цены: заведомо мелкая сделка, где impact пренебрежим. */
export function referenceProbeAmount(direction: SwapDirection): bigint {
  // 0.001 WETH и 1 млн $VLTR — на этих величинах цена ещё рыночная (проверено квотами).
  return direction === "buy" ? 10n ** 15n : 10n ** 24n;
}

/**
 * Насколько хуже курса эталонной мелкой сделки исполняется наша, в bps.
 *
 * Считаем кросс-умножением в bigint, без деления в double: курсы здесь — это отношения
 * величин по 10^18, и float на них врёт. Отрицательный результат (исполнение лучше
 * эталона — бывает на округлениях) схлопываем в 0.
 */
export function computeImpactBps(
  reference: { sellAmount: bigint; buyAmount: bigint },
  actual: { sellAmount: bigint; buyAmount: bigint },
): number {
  if (reference.sellAmount <= 0n || reference.buyAmount <= 0n) return 0;
  if (actual.sellAmount <= 0n || actual.buyAmount <= 0n) return 10_000;

  // ratio = (actualRate / referenceRate) в bps, где rate = buyAmount / sellAmount
  const ratioBps =
    (actual.buyAmount * reference.sellAmount * 10_000n) /
    (actual.sellAmount * reference.buyAmount);
  const impact = 10_000n - ratioBps;
  if (impact <= 0n) return 0;
  return impact > 10_000n ? 10_000 : Number(impact);
}

export type ImpactVerdict = "ok" | "warn" | "block";

/** Что делать с посчитанным impact. Пороги названы явно, чтобы UI и роут решали одинаково. */
export function impactVerdict(impactBps: number): ImpactVerdict {
  if (impactBps >= MAX_IMPACT_BPS) return "block";
  if (impactBps >= WARN_IMPACT_BPS) return "warn";
  return "ok";
}

/**
 * Спендер для `approve`. Берём ТОЛЬКО из `issues.allowance.spender` (или `allowanceTarget`)
 * и никогда из `transaction.to`: там Settler, его адрес меняется от деплоя к деплою, и
 * апрув на него — это разрешение на трату токенов адресу, который завтра другой.
 */
export function spenderFromQuote(raw: unknown): `0x${string}` | null {
  if (raw === null || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;

  const issues = (q.issues ?? {}) as Record<string, unknown>;
  const allowance = (issues.allowance ?? null) as Record<string, unknown> | null;
  const candidate =
    (typeof allowance?.spender === "string" ? allowance.spender : null) ??
    (typeof q.allowanceTarget === "string" ? q.allowanceTarget : null);

  if (!candidate || !isAddress(candidate, { strict: false })) return null;
  return getAddress(candidate);
}

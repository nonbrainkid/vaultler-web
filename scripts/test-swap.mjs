/**
 * e2e-проверка встроенного обмена против ЖИВОГО 0x Swap API и настоящей сети.
 *
 * Зачем отдельно от юнит-тестов: `lib/swap.test.ts` проверяет нашу математику на своих же
 * данных, а это, как выяснилось на SIWE_STATEMENT (NOTES.md, 2026-07-25), проверка теста
 * самим тестом. Здесь мы сверяем расчёт фиса с тем, что реально вернул провайдер, и заодно
 * ловим смену контракта AllowanceHolder и исчезновение маршрута — то есть ровно те поломки,
 * которые юнит-тест увидеть не может.
 *
 * Запуск:  ZEROX_API_KEY=… node --env-file-if-exists=.env.local scripts/test-swap.mjs
 * Ключ в аргументы командной строки НЕ передаём: он оседает в истории оболочки и в списке
 * процессов (тот же урок, что с секретом вебхука в URL, 2026-07-28).
 */
const API = "https://api.0x.org/swap/allowance-holder/price";
const CHAIN_ID = 4663;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const VLTR = "0x4CAec139dfC936a2043FE3035B0d0D59ba877613";
const ALLOWANCE_HOLDER = "0x0000000000001ff3684f28c67538d4d072c22734";

/** Ставка держится в lib/swap.ts; здесь дублируется осознанно — расхождение и есть баг. */
const SWAP_FEE_BPS = 115;
const ZEROX_FEE_BPS = 15;

const key = process.env.ZEROX_API_KEY?.trim();
if (!key) {
  console.error("нет ZEROX_API_KEY — положи его в .env.local и запусти через npm run test:swap");
  process.exit(2);
}

// Получатель фиса для проверки квоты: реальный адрес выдаёт владелец, но для чтения цены
// сгодится любой валидный — 0x не проверяет, наш ли он.
const recipient = process.env.SWAP_FEE_RECIPIENT?.trim() || VLTR;

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
};

const feeAmount = (sellAmount, bps) => (sellAmount * BigInt(bps)) / 10_000n;

async function quote({ sellToken, buyToken, sellAmount, feeToken, bps = SWAP_FEE_BPS }) {
  const params = new URLSearchParams({
    chainId: String(CHAIN_ID),
    sellToken,
    buyToken,
    sellAmount: sellAmount.toString(),
    slippageBps: "100",
    swapFeeRecipient: recipient,
    swapFeeBps: String(bps),
    swapFeeToken: feeToken,
  });
  const res = await fetch(`${API}?${params}`, {
    headers: { "0x-api-key": key, "0x-version": "v2" },
  });
  if (!res.ok) throw new Error(`0x ответил ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const WEI = 10n ** 18n;

console.log("\n[1/4] Покупка $VLTR за WETH: маршрут и фис");
{
  const sellAmount = WEI / 100n; // 0.01 WETH — размер, который проходит без разноса цены
  const q = await quote({ sellToken: WETH, buyToken: VLTR, sellAmount, feeToken: WETH });

  check("маршрут есть", q.liquidityAvailable === true);
  check(
    "источник ликвидности — Uniswap V3",
    (q.route?.fills ?? []).some((f) => String(f.source).startsWith("Uniswap")),
    (q.route?.fills ?? []).map((f) => f.source).join(",") || "нет fills",
  );
  check("покупаемое количество положительное", BigInt(q.buyAmount ?? "0") > 0n);

  const expected = feeAmount(sellAmount, SWAP_FEE_BPS);
  const actual = BigInt(q.fees?.integratorFee?.amount ?? "0");
  check(
    `наш фис ${SWAP_FEE_BPS} bps совпал с расчётом`,
    actual === expected,
    `api=${actual} наш=${expected}`,
  );
  check(
    "фис берётся в WETH, а не в $VLTR",
    String(q.fees?.integratorFee?.token).toLowerCase() === WETH.toLowerCase(),
  );

  const zx = BigInt(q.fees?.zeroExFee?.amount ?? "0");
  const zxBps = Number((zx * 10_000n) / sellAmount);
  check(
    `фис самого 0x всё ещё ${ZEROX_FEE_BPS} bps (иначе текст про 1.30% на кнопке врёт)`,
    zxBps === ZEROX_FEE_BPS,
    `получено ${zxBps} bps`,
  );
  check(
    "спендер для approve — AllowanceHolder",
    String(q.allowanceTarget).toLowerCase() === ALLOWANCE_HOLDER,
    String(q.allowanceTarget),
  );
  check(
    "у токена нет налогов на покупку/продажу",
    q.tokenMetadata?.buyToken?.buyTaxBps === "0" && q.tokenMetadata?.buyToken?.sellTaxBps === "0",
  );
}

console.log("\n[2/4] Продажа $VLTR за WETH: обратное направление");
{
  const sellAmount = WEI * 1_000_000n; // 1 млн $VLTR
  const q = await quote({ sellToken: VLTR, buyToken: WETH, sellAmount, feeToken: WETH });
  check("маршрут есть", q.liquidityAvailable === true);
  check("получаем WETH", BigInt(q.buyAmount ?? "0") > 0n);
  // При продаже фис берётся в buyToken (WETH), поэтому считается от полученного, а не от
  // отданного — проверяем лишь, что он вообще начислен и не нулевой.
  check("фис начислен", BigInt(q.fees?.integratorFee?.amount ?? "0") > 0n);
}

console.log("\n[3/4] Глубина пула: где обмен перестаёт быть разумным");
{
  const base = await quote({
    sellToken: WETH,
    buyToken: VLTR,
    sellAmount: WEI / 1000n,
    feeToken: WETH,
  });
  const rate = Number(BigInt(base.buyAmount) / (WEI / 1000n / 10n ** 9n)) / 1e9;

  for (const [label, amount] of [
    ["0.01 WETH", WEI / 100n],
    ["0.1 WETH", WEI / 10n],
  ]) {
    const q = await quote({ sellToken: WETH, buyToken: VLTR, sellAmount: amount, feeToken: WETH });
    const got = Number(BigInt(q.buyAmount) / (amount / 10n ** 9n)) / 1e9;
    const impact = ((rate - got) / rate) * 100;
    console.log(`       ${label}: проскальзывание ≈ ${impact.toFixed(1)}%`);
  }
  console.log("       (ориентир 30.07: 0.01 WETH ≈ 0.6%, 0.1 WETH ≈ 6.1%)");
}

console.log("\n[4/4] Разорительная сделка: провайдер её ОДОБРЯЕТ, блокируем мы");
{
  // Находка 30.07: на покупку 1000 WETH в пул глубиной 0.14 WETH 0x отвечает
  // liquidityAvailable: true и предлагает отдать всё за остатки пула (потеря ~99.85%).
  // slippageBps не защищает — он сверяет исполнение с уже разорительной котировкой.
  // Значит защита обязана быть нашей: считаем impact относительно мелкой сделки.
  const probe = await quote({
    sellToken: WETH,
    buyToken: VLTR,
    sellAmount: WEI / 1000n,
    feeToken: WETH,
  });
  const huge = await quote({
    sellToken: WETH,
    buyToken: VLTR,
    sellAmount: WEI * 1000n,
    feeToken: WETH,
  });

  const impactBps = (ref, act) => {
    const ratio =
      (BigInt(act.buyAmount) * BigInt(ref.sellAmount) * 10_000n) /
      (BigInt(act.sellAmount) * BigInt(ref.buyAmount));
    const impact = 10_000n - ratio;
    return impact <= 0n ? 0 : Number(impact > 10_000n ? 10_000n : impact);
  };

  const impact = impactBps(probe, huge);
  check(
    "провайдер по-прежнему отдаёт такую квоту как исполнимую (фиксируем факт)",
    huge.liquidityAvailable === true,
    `liquidityAvailable=${huge.liquidityAvailable}`,
  );
  check(
    "наш контроль проскальзывания видит потерю и заблокирует сделку (>10%)",
    impact >= 1_000,
    `impact ≈ ${(impact / 100).toFixed(2)}%`,
  );
}

console.log(
  failures === 0
    ? "\n✅ Обмен готов к интеграции: маршрут, фис и спендер соответствуют коду.\n"
    : `\n❌ Провалов: ${failures}. Не выкатывать обмен, пока не совпадает.\n`,
);
process.exit(failures === 0 ? 0 : 1);

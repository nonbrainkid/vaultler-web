/**
 * Серверное чтение чейна для холдерского буста (лестница `HOLDER_TIERS` в lib/game.ts).
 *
 * КРИТИЧНО (безопасность): тир определяет СЕРВЕР, читая баланс и эмиссию on-chain,
 * а НЕ клиент. Иначе любой не-холдер объявил бы себя китом и получил бы ×5 нечестно.
 * Здесь мы только читаем публичные значения — приватники не трогаем, транзакций нет.
 *
 * Второй инвариант, не менее важный: «не удалось прочитать» ≠ «баланс нулевой».
 * При ошибке RPC возвращается `null`, и вызывающий код обязан сохранить прежний тир:
 * честный холдер не должен терять множитель из-за сетевого сбоя.
 *
 * Третий: тир считается от ДОЛИ в эмиссии, а не от абсолютного числа токенов
 * (обоснование — комментарий к `HOLDER_TIERS`). Поэтому читаем два значения:
 * `balanceOf(игрок)` и `totalSupply()`.
 */
import { createPublicClient, http, erc20Abi, formatUnits, parseUnits } from "viem";
import { robinhoodChain, VLTR, VLTR_CONFIGURED } from "./chain";
import {
  HOLDER_TIERS,
  MAX_HOLDER_LEVEL,
  holderTierFromPpb,
  nextHolderTier,
  type HolderRead,
} from "./game";

/** RPC не имеет права подвешивать кранк — читаем с потолком по времени. */
const READ_TIMEOUT_MS = 4000;

/**
 * Сколько живёт закэшированная эмиссия. Не «вечно»: у мем-токенов бывают догоминты и
 * бёрны, а эмиссия — знаменатель всех порогов, устаревшее значение сдвинуло бы лестницу
 * целиком. Но и читать её на каждый кранк не нужно — меняется она редко.
 */
const SUPPLY_TTL_MS = 10 * 60 * 1000;

const rpc = robinhoodChain.rpcUrls.default.http[0];
const client = rpc
  ? createPublicClient({
      chain: robinhoodChain,
      transport: http(rpc, { timeout: READ_TIMEOUT_MS, retryCount: 1 }),
    })
  : null;

/**
 * `decimals` токена. Читаем с контракта, а не доверяем env: рассинхрон сдвинул бы порог
 * на порядки — буст получили бы либо все, либо никто. Значение неизменно, поэтому
 * кэшируем, но ТОЛЬКО успешное чтение: иначе разовый сбой RPC зафиксировал бы фолбэк
 * из env навсегда.
 */
let decimalsCache: number | null = null;

async function tokenDecimals(): Promise<number> {
  if (decimalsCache !== null) return decimalsCache;
  try {
    const d = await client!.readContract({
      address: VLTR.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    decimalsCache = Number(d);
    return decimalsCache;
  } catch {
    return VLTR.decimals; // не кэшируем — дадим следующему вызову шанс прочитать
  }
}

/** Кэш эмиссии. Как и с decimals, кэшируем только успешное чтение. */
let supplyCache: { raw: bigint; at: number } | null = null;

async function tokenSupply(now: number): Promise<bigint | null> {
  if (supplyCache && now - supplyCache.at < SUPPLY_TTL_MS) return supplyCache.raw;
  try {
    const raw = (await client!.readContract({
      address: VLTR.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "totalSupply",
    })) as bigint;
    supplyCache = { raw, at: now };
    return raw;
  } catch {
    // Протухший кэш всё же лучше, чем «не знаю»: эмиссия меняется редко, а отказ
    // прочитать её иначе снял бы буст у всех холдеров сразу.
    return supplyCache?.raw ?? null;
  }
}

export type BalanceRead =
  | { ok: true; raw: bigint; decimals: number }
  | { ok: false };

/** Баланс $VLTR в единицах токена (raw). `ok:false` — прочитать не удалось. */
export async function readVltrBalance(address: string): Promise<BalanceRead> {
  if (!client || !VLTR_CONFIGURED || !VLTR.address) return { ok: false };
  try {
    const decimals = await tokenDecimals();
    const raw = (await client.readContract({
      address: VLTR.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    })) as bigint;
    return { ok: true, raw, decimals };
  } catch {
    return { ok: false };
  }
}

/**
 * Доля баланса в эмиссии, в ppb (parts per billion, 1e-9).
 *
 * Целиком в bigint: перевод баланса в Number терял бы точность уже на десятых долях
 * токена при 18 decimals, а здесь считается величина, дающая пятикратное начисление.
 * `decimals` в формуле сокращаются — баланс и эмиссия в одних единицах.
 * Результат ≤ 1e9 и представим в Number точно.
 *
 * Чистая функция — вынесена отдельно, чтобы покрыть границы тиров тестами без сети.
 */
export function shareInPpb(raw: bigint, supply: bigint): number {
  if (supply <= 0n || raw <= 0n) return 0;
  return Number((raw * 1_000_000_000n) / supply);
}

/**
 * Достаточно ли баланса, чтобы вообще считаться холдером.
 *
 * Абсолютный анти-дуст-порог (`NEXT_PUBLIC_VLTR_BOOST_MIN`) поверх долевых тиров: он
 * страхует от вырожденной конфигурации токена, где мизерная эмиссия делает 0.001% пылью.
 * Сравнение целиком в bigint — по той же причине, что и в `shareInPpb`.
 */
export function meetsBoostThreshold(
  raw: bigint,
  decimals: number,
  minTokens: string,
): boolean {
  return raw >= parseUnits(minTokens, decimals);
}

/** Сколько единиц токена нужно иметь для доли `ppb` при данной эмиссии (округление вверх). */
export function rawForPpb(ppb: number, supply: bigint): bigint {
  if (supply <= 0n || ppb <= 0) return 0n;
  const target = BigInt(Math.ceil(ppb));
  return (target * supply + 999_999_999n) / 1_000_000_000n;
}

export interface HolderStatus {
  /** Тир и доля — именно это уходит в стейт игрока. */
  read: HolderRead;
  /** Свой баланс в токенах (для UI игрока; чужие балансы наружу не отдаём никогда). */
  balance: string;
  /** Сколько токенов не хватает до следующей ступени; null — игрок уже на вершине. */
  toNext: string | null;
}

/**
 * Полный статус холда для UI: тир, баланс и сколько докупить до следующей ступени.
 *
 * Именно «сколько докупить» и создаёт причину держать больше: старый булев ×5 такой
 * цели не давал вообще — купил порог и остановился.
 *
 * `null` — определить не удалось (RPC молчит). Вызывающий обязан сохранить прежний тир.
 */
export async function readHolderStatus(
  address: string,
  now: number = Date.now(),
): Promise<HolderStatus | null> {
  // Отладочный рубильник работает ТОЛЬКО вне прода. Случайно выставленная переменная
  // в env Vercel раздала бы верхний тир всем сразу — а множитель определяет, кто попадёт
  // в топ-10 и разделит призовой пул из реальных токенов. Такая ошибка не должна быть
  // возможна в один клик по панели.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_FORCE_BOOST === "1") {
    const top = HOLDER_TIERS[MAX_HOLDER_LEVEL];
    return { read: { tier: top.level, ppb: top.minPpb }, balance: "0", toNext: null };
  }

  // Токена/сети ещё нет — это не сбой, а достоверное «буста нет ни у кого».
  if (!VLTR_CONFIGURED) return { read: { tier: 0, ppb: 0 }, balance: "0", toNext: null };

  const bal = await readVltrBalance(address);
  if (!bal.ok) return null;

  const supply = await tokenSupply(now);
  if (supply === null) return null; // эмиссию не знаем → долю не посчитать
  // Эмиссия 0 при настроенном токене — это не «сбой сети», а неверный адрес контракта.
  // Доли в нулевой эмиссии нет ни у кого: честнее отдать «буста нет», чем делить на ноль.
  if (supply <= 0n) return { read: { tier: 0, ppb: 0 }, balance: "0", toNext: null };

  const ppb = shareInPpb(bal.raw, supply);
  // Анти-дуст: ниже абсолютного минимума тира нет, какой бы ни была доля.
  const dust = !meetsBoostThreshold(bal.raw, bal.decimals, VLTR.boostMin);
  const tier = dust ? 0 : holderTierFromPpb(ppb);

  const next = nextHolderTier(tier);
  let toNext: string | null = null;
  if (next) {
    const need = rawForPpb(next.minPpb, supply) - bal.raw;
    toNext = formatUnits(need > 0n ? need : 0n, bal.decimals);
  }

  return { read: { tier, ppb }, balance: formatUnits(bal.raw, bal.decimals), toNext };
}

/**
 * Тир холда для адреса — то, что нужно кранку.
 *
 * `null` — определить НЕ удалось (RPC молчит). На `null` вызывающий код обязан сохранить
 * прежний тир: снимать множитель из-за сетевого сбоя нельзя, а выдавать незаслуженно —
 * тем более.
 */
export async function computeHolderBoost(
  address: string,
  now: number = Date.now(),
): Promise<HolderRead | null> {
  return (await readHolderStatus(address, now))?.read ?? null;
}

/** Только для тестов: сбросить кэши между кейсами. */
export function resetVltrCachesForTests(): void {
  decimalsCache = null;
  supplyCache = null;
}

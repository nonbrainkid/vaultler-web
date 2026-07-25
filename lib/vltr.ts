/**
 * Серверное чтение баланса $VLTR для буста ×5 (GAME.BOOST_MULT).
 *
 * КРИТИЧНО (безопасность): буст определяет СЕРВЕР, читая баланс on-chain, а НЕ клиент.
 * Иначе любой не-холдер объявил бы себя холдером и получил ×5 нечестно.
 * Здесь мы только читаем публичный баланс — приватники не трогаем, транзакций нет.
 *
 * Второй инвариант, не менее важный: «не удалось прочитать» ≠ «баланс нулевой».
 * Раньше при ошибке RPC возвращался 0, и честный холдер молча терял ×5 из-за сетевого
 * сбоя. Теперь неудача возвращается отдельным значением, а вызывающий код обязан
 * сохранить прежнее состояние буста.
 */
import { createPublicClient, http, erc20Abi, parseUnits } from "viem";
import { robinhoodChain, VLTR, VLTR_CONFIGURED } from "./chain";

/** RPC не имеет права подвешивать кранк — читаем с потолком по времени. */
const READ_TIMEOUT_MS = 4000;

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
 * Достаточно ли баланса для буста. Сравнение целиком в bigint: перевод в Number
 * терял бы точность уже на десятых долях токена при 18 decimals, а это граница,
 * дающая пятикратное начисление.
 *
 * Чистая функция — вынесена отдельно, чтобы покрыть порог тестами без сети.
 */
export function meetsBoostThreshold(
  raw: bigint,
  decimals: number,
  minTokens: string,
): boolean {
  return raw >= parseUnits(minTokens, decimals);
}

/**
 * Активен ли буст для адреса.
 *
 * `true`/`false` — определено достоверно; `null` — определить НЕ удалось (RPC молчит).
 * На `null` вызывающий код обязан сохранить прежний буст: снимать ×5 из-за сетевого
 * сбоя нельзя, а выдавать незаслуженно — тем более.
 */
export async function computeBoost(address: string): Promise<boolean | null> {
  // Отладочный рубильник работает ТОЛЬКО вне прода. Случайно выставленная переменная
  // в env Vercel раздала бы ×5 всем сразу — а множитель определяет, кто попадёт в топ-10
  // и разделит призовой пул из реальных токенов. Такая ошибка не должна быть возможна
  // в один клик по панели.
  if (process.env.NODE_ENV !== "production" && process.env.DEV_FORCE_BOOST === "1") {
    return true;
  }
  // Токена/сети ещё нет — это не сбой, а достоверное «буста нет ни у кого».
  if (!VLTR_CONFIGURED) return false;

  const read = await readVltrBalance(address);
  if (!read.ok) return null;
  return meetsBoostThreshold(read.raw, read.decimals, VLTR.boostMin);
}

/** Только для тестов: сбросить кэш decimals между кейсами. */
export function resetDecimalsCacheForTests(): void {
  decimalsCache = null;
}

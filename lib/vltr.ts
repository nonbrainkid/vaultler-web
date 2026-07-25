/**
 * Серверное чтение баланса $VLTR для буста ×5 (GAME.BOOST_MULT).
 *
 * КРИТИЧНО (безопасность): буст определяет СЕРВЕР, читая баланс on-chain, а НЕ клиент.
 * Иначе любой не-холдер объявил бы себя холдером и получил ×5 нечестно.
 * Здесь мы только читаем публичный баланс — приватники не трогаем, транзакций нет.
 */
import { createPublicClient, http, erc20Abi } from "viem";
import { robinhoodChain, VLTR, VLTR_CONFIGURED } from "./chain";

const rpc = robinhoodChain.rpcUrls.default.http[0];
const client = rpc
  ? createPublicClient({ chain: robinhoodChain, transport: http(rpc) })
  : null;

/** Баланс $VLTR в человекочитаемых единицах (с учётом decimals). 0 при ошибке/без конфига. */
export async function readVltrBalance(address: string): Promise<number> {
  if (!client || !VLTR_CONFIGURED || !VLTR.address) return 0;
  try {
    const raw = (await client.readContract({
      address: VLTR.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    })) as bigint;
    return Number(raw) / 10 ** VLTR.decimals;
  } catch {
    return 0;
  }
}

/**
 * Активен ли буст для адреса. `DEV_FORCE_BOOST=1` включает буст принудительно —
 * для локального теста пути буста, пока нет реальной сети/токена.
 */
export async function computeBoost(address: string): Promise<boolean> {
  if (process.env.DEV_FORCE_BOOST === "1") return true;
  const bal = await readVltrBalance(address);
  return bal >= VLTR.boostMin;
}

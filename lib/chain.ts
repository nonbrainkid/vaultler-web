/**
 * Конфиг сети Robinhood Chain (Arbitrum Orbit L2) и токена $VLTR.
 *
 * ВСЕ значения берутся из env — реальные RPC/chainId/адрес токена подставим позже
 * (доки Robinhood Chain отложены, см. NOTES.md → открытые вопросы). Плейсхолдеры, чтобы весь
 * флоу кошелька собирался и тестировался off-chain (подпись сообщения сети не требует).
 */
import { defineChain } from "viem";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_RH_CHAIN_ID ?? "88991"); // PLACEHOLDER
const RPC_URL = process.env.NEXT_PUBLIC_RH_RPC_URL ?? ""; // пусто → чтение баланса выключено
const CHAIN_NAME = process.env.NEXT_PUBLIC_RH_NAME ?? "Robinhood Chain";
const EXPLORER = process.env.NEXT_PUBLIC_RH_EXPLORER ?? "";

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: RPC_URL ? [RPC_URL] : [] },
  },
  blockExplorers: EXPLORER
    ? { default: { name: "Explorer", url: EXPLORER } }
    : undefined,
  testnet: true,
});

export const VLTR = {
  address: (process.env.NEXT_PUBLIC_VLTR_ADDRESS ?? "") as `0x${string}` | "",
  /** Фолбэк decimals. Основной источник — сам контракт (см. lib/vltr.ts). */
  decimals: Number(process.env.NEXT_PUBLIC_VLTR_DECIMALS ?? "18"),
  /**
   * Минимум токенов на балансе для активации буста ×5 (GAME.BOOST_MULT).
   * Держим СТРОКОЙ: порог переводится в единицы токена через `parseUnits`, а число
   * по пути в строку и обратно теряет точность и на больших значениях уезжает
   * в экспоненциальную запись, которую `parseUnits` не примет.
   */
  boostMin: process.env.NEXT_PUBLIC_VLTR_BOOST_MIN?.trim() || "1",
};

export const RPC_CONFIGURED = RPC_URL.length > 0;
export const VLTR_CONFIGURED = VLTR.address.length > 0 && RPC_CONFIGURED;

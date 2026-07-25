/**
 * Конфиг сети Robinhood Chain (Arbitrum Orbit L2) и токена $VLTR.
 *
 * ВСЕ значения берутся из env — реальные RPC/chainId/адрес токена подставим позже
 * (доки Robinhood Chain отложены, см. NOTES.md → открытые вопросы). Плейсхолдеры, чтобы весь
 * флоу кошелька собирался и тестировался off-chain (подпись сообщения сети не требует).
 */
import { defineChain, getAddress, isAddress } from "viem";

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

/**
 * Адрес контракта $VLTR. Задеплоен 2026-07-25.
 *
 * Значение по умолчанию держим В КОДЕ, а не только в env Vercel, специально:
 *  - сайт показывает адрес, по которому люди покупают токен. Опечатка в текстовом поле
 *    панели уехала бы в прод без ревью и диффа — а перепутанный адрес на странице
 *    мем-токена это ровно тот вектор, которым у людей забирают деньги. В git он проходит
 *    ревью, виден в истории и одинаков во всех окружениях;
 *  - адрес — публичный факт, а не секрет: скрывать его незачем.
 * Env-переопределение оставлено для тестовых сетей и локального anvil.
 */
const VLTR_ADDRESS_DEFAULT = "0x4CAec139dfC936a2043FE3035B0d0D59ba877613";
const RAW_VLTR_ADDRESS = process.env.NEXT_PUBLIC_VLTR_ADDRESS?.trim() || VLTR_ADDRESS_DEFAULT;

/**
 * Проверенный и приведённый к EIP-55 адрес — ОДНО значение и для показа на странице,
 * и для чтения баланса on-chain. Иначе сайт мог бы рекламировать один контракт, а буст
 * считать по другому.
 *
 * Битое значение (опечатка в env) превращается в пустую строку: лучше не показать адрес
 * вовсе, чем показать неверный. Пустой адрес выключает буст через `VLTR_CONFIGURED`.
 */
export const VLTR_ADDRESS: `0x${string}` | "" = isAddress(RAW_VLTR_ADDRESS, { strict: false })
  ? getAddress(RAW_VLTR_ADDRESS)
  : "";

export const VLTR = {
  address: VLTR_ADDRESS,
  /** Фолбэк decimals. Основной источник — сам контракт (см. lib/vltr.ts). */
  decimals: Number(process.env.NEXT_PUBLIC_VLTR_DECIMALS ?? "18"),
  /**
   * Абсолютный анти-дуст-минимум на балансе. Сам множитель задаётся ДОЛЕЙ в эмиссии
   * (лестница `HOLDER_TIERS` в lib/game.ts), этот порог лишь страхует вырожденную
   * конфигурацию токена с мизерной эмиссией.
   * Держим СТРОКОЙ: порог переводится в единицы токена через `parseUnits`, а число
   * по пути в строку и обратно теряет точность и на больших значениях уезжает
   * в экспоненциальную запись, которую `parseUnits` не примет.
   */
  boostMin: process.env.NEXT_PUBLIC_VLTR_BOOST_MIN?.trim() || "1",
};

export const RPC_CONFIGURED = RPC_URL.length > 0;
export const VLTR_CONFIGURED = VLTR.address.length > 0 && RPC_CONFIGURED;

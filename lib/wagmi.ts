/**
 * wagmi-конфиг (клиент). Своя кнопка коннекта — без сторонних модалов (React 19 + своя тема).
 *
 * Коннекторы: wagmi v2 сам находит установленные кошельки по EIP-6963 (MetaMask, Phantom,
 * Rabby, OKX, Brave…) — они появятся в списке автоматически. Плюс явные таргеты ниже,
 * чтобы кнопки были видны даже когда кошелёк ещё не установлен.
 * WalletConnect/Coinbase SDK не тянем (лишние зависимости) — включим при projectId.
 */
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhoodChain } from "./chain";

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected({ target: "metaMask" }),
    injected({ target: "phantom" }),
    injected(), // любой другой браузерный кошелёк + автоподхват EIP-6963
  ],
  transports: { [robinhoodChain.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

/** wagmi-конфиг (клиент). Своя кнопка коннекта — без сторонних модалов (React 19 + тема). */
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhoodChain } from "./chain";

// M2: только injected (MetaMask / in-app браузеры кошельков) — без лишних зависимостей.
// WalletConnect (внешний мобильный) и Coinbase добавим, когда будет projectId (см. NOTES.md).
export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: { [robinhoodChain.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

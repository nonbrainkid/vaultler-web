/** Общее для клиента и сервера: параметры входа кошельком (SIWE / EIP-4361). */

export const NONCE_COOKIE = "vaultler_nonce";

/** Текст, который кошелёк покажет пользователю при подписи. Явно про отсутствие рисков. */
export const SIWE_STATEMENT =
  "Sign in to The Vaultler. This proves you own this wallet — no transaction, no gas, no access to your funds.";

/** Сколько действует подпись. Короткое окно: пойманная подпись быстро протухает. */
export const SIWE_TTL_MS = 5 * 60 * 1000;

/**
 * Ожидаемый домен для проверки SIWE-сообщения.
 * В проде пиним через AUTH_DOMAIN (Host-заголовок можно подделать); локально берём Host.
 * Домен в подписанном сообщении кошелёк показывает пользователю — если фишинг-сайт
 * подсунет свой домен, наш сервер отвергнет подпись (домен не сойдётся).
 */
export function expectedAuthDomain(hostHeader: string | null): string | undefined {
  return process.env.AUTH_DOMAIN || hostHeader || undefined;
}

/** Идентичность игрока по адресу кошелька (нижний регистр = один аккаунт на кошелёк). */
export function walletIdentity(address: string): string {
  return "wallet:" + address.toLowerCase();
}

/** Адрес из wallet-идентичности, либо null для анонимной dev-сессии. */
export function addressFromIdentity(identity: string): string | null {
  return identity.startsWith("wallet:") ? identity.slice("wallet:".length) : null;
}

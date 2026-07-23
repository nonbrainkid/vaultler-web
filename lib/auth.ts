/** Общее для клиента и сервера: формат сообщения для подписи и имя nonce-cookie. */

export const NONCE_COOKIE = "vaultler_nonce";

/**
 * Сообщение, которое подписывает кошелёк для входа (SIWE-стиль).
 * Клиент и сервер ДОЛЖНЫ строить его одинаково, иначе подпись не сойдётся.
 * Подпись сообщения — это не транзакция: без газа, без движения средств.
 */
export function buildAuthMessage(address: string, nonce: string): string {
  return [
    "The Vaultler — Sign in to stack.",
    "",
    "This only proves you own this wallet.",
    "No transaction, no gas, no funds moved.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

/** Идентичность игрока по адресу кошелька (нижний регистр = один аккаунт на кошелёк). */
export function walletIdentity(address: string): string {
  return "wallet:" + address.toLowerCase();
}

/** Адрес из wallet-идентичности, либо null для анонимной dev-сессии. */
export function addressFromIdentity(identity: string): string | null {
  return identity.startsWith("wallet:") ? identity.slice("wallet:".length) : null;
}

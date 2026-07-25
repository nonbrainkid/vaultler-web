/** Общее для клиента и сервера: параметры входа кошельком (SIWE / EIP-4361). */

export const NONCE_COOKIE = "vaultler_nonce";

/**
 * Текст, который кошелёк покажет пользователю при подписи. Явно про отсутствие рисков.
 *
 * ТОЛЬКО ASCII из набора ниже — это не стилистика, а требование EIP-4361:
 *   statement = 1*( reserved / unreserved / " " )
 * где классы взяты из RFC 3986, то есть буквы, цифры и `-._~:/?#[]@!$&'()*+,;=`.
 *
 * Здесь стояло длинное тире «—» (U+2014). Phantom проверяет ABNF строго и отказывался
 * подписывать с ошибкой «signature request cannot be shown due to invalid formatting» —
 * вход не работал вообще. Регрессия закрыта тестом в lib/auth.test.ts.
 */
export const SIWE_STATEMENT =
  "Sign in to The Vaultler. This proves you own this wallet: no transaction, no gas, no access to your funds.";

/**
 * Допустимые символы statement по EIP-4361 (RFC 3986 reserved / unreserved / пробел).
 * Вынесено, чтобы правило было проверяемым, а не жило в комментарии.
 */
export const SIWE_STATEMENT_ALLOWED = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;= ]+$/;

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

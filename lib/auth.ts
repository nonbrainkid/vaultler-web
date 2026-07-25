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
 * Запас на расхождение часов клиента и сервера при проверке срока подписи.
 * Без него честный вход с чуть спешащими часами отвергался бы как «из будущего».
 */
export const SIWE_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Ошибка конфигурации: домен для проверки SIWE не задан там, где он обязателен. */
export class AuthDomainNotConfigured extends Error {
  constructor() {
    super(
      "AUTH_DOMAIN не задан в production. Он пинит домен, по которому проверяется " +
        "SIWE-подпись; без него домен берётся из подделываемого заголовка Host. " +
        "Выставьте AUTH_DOMAIN в env (docs/deployment.md).",
    );
  }
}

/**
 * Ожидаемый домен для проверки SIWE-сообщения.
 *
 * Домен в подписанном сообщении кошелёк показывает пользователю, и сервер обязан
 * сверить его со СВОИМ доменом. Если брать домен из заголовка Host, проверка сверяет
 * подпись с тем, что прислал сам запрос, — то есть не проверяет ничего: атакующий
 * собирает у жертвы подпись для домена `evil.example`, а затем шлёт её нам с
 * `Host: evil.example` и получает сессию от имени её кошелька.
 *
 * Поэтому в production AUTH_DOMAIN обязателен — падаем громко, а не тихо теряем
 * защиту. Локально Host допустим: там нет ни реальных призов, ни чужих кошельков.
 */
export function expectedAuthDomain(hostHeader: string | null): string {
  const pinned = process.env.AUTH_DOMAIN?.trim();
  if (pinned) return pinned;

  if (process.env.NODE_ENV === "production") throw new AuthDomainNotConfigured();

  const host = hostHeader?.trim();
  if (!host) throw new AuthDomainNotConfigured();
  return host;
}

/** Идентичность игрока по адресу кошелька (нижний регистр = один аккаунт на кошелёк). */
export function walletIdentity(address: string): string {
  return "wallet:" + address.toLowerCase();
}

/** Адрес из wallet-идентичности, либо null для анонимной dev-сессии. */
export function addressFromIdentity(identity: string): string | null {
  return identity.startsWith("wallet:") ? identity.slice("wallet:".length) : null;
}

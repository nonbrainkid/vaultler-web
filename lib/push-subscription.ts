/**
 * Разбор и валидация подписки на веб-пуши, пришедшей от клиента.
 *
 * Чистый модуль (кроме SHA-256 из node:crypto) — роут остаётся тонким, а правила проверяются
 * юнит-тестом.
 *
 * Что здесь на самом деле охраняется. Подписка — это URL, по которому НАШ сервер потом сам
 * шлёт POST'ы по расписанию. То есть клиент даёт нам адрес исходящего запроса, а такие
 * адреса нельзя брать на слово: подставив `http://169.254.169.254/…` или
 * `https://localhost/admin`, игрок превратил бы нашу рассылку в сканер внутренней сети
 * (SSRF), причём с нашего IP и по расписанию. Поэтому endpoint обязан быть https и вести на
 * публичное DNS-имя, а не на IP-литерал или локальный хост.
 *
 * Ключи проверяются по длине ДО записи в стор: подписка с битым `p256dh` не зашифруется
 * никогда, и лучше отказать сразу, чем каждые 10 минут ронять на ней прогон рассылки.
 */
import { createHash } from "node:crypto";

export interface ParsedSubscription {
  endpoint: string;
  /** Публичный ключ агента, base64url, uncompressed P-256 (65 байт). */
  p256dh: string;
  /** Секрет подписки, base64url (16 байт). */
  auth: string;
}

export type ParseError = "bad_subscription" | "bad_endpoint";

export type ParseResult =
  | { ok: true; value: ParsedSubscription }
  | { ok: false; error: ParseError };

/** Потолок длины endpoint'а: реальные — 100–400 символов, всё длиннее не пишем в стор. */
const MAX_ENDPOINT_LEN = 1024;

const B64URL = /^[A-Za-z0-9_-]+$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Строгий разбор base64url в байты. Сначала регэксп, потом декодирование: `Buffer.from`
 * молча игнорирует посторонние символы, поэтому без регэкспа мусор нужной длины прошёл бы
 * проверку и лёг в базу.
 */
function b64urlBytes(value: unknown, expectedLen: number): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
  const trimmed = value.replace(/=+$/, "");
  if (!B64URL.test(trimmed)) return null;
  const buf = Buffer.from(trimmed, "base64url");
  if (buf.length !== expectedLen) return null;
  return trimmed;
}

/**
 * Годен ли endpoint как адрес НАШЕГО исходящего запроса.
 * Отдельная экспортируемая функция — проверять её надо не только на входе, но и (в будущем)
 * при чтении старых записей из стора.
 */
export function isAllowedEndpoint(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_ENDPOINT_LEN) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  // Логин/пароль в URL: мы бы отправляли их в заголовке Authorization... поверх нашего
  // же VAPID-заголовка. Такого endpoint'а не бывает у настоящих сервисов.
  if (url.username || url.password) return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // IP-литерал (v4 или v6 в скобках) — единственный способ адресовать метаданные облака и
  // внутреннюю сеть. Настоящие push-сервисы живут на DNS-именах.
  if (IPV4.test(host) || host.includes(":") || raw.includes("[")) return false;
  if (!host.includes(".")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".home.arpa")) {
    return false;
  }
  return true;
}

/**
 * Разобрать тело `POST /api/push/subscribe`.
 *
 * Принимаем и стандартный `PushSubscription.toJSON()` (`{endpoint, keys:{p256dh, auth}}`), и
 * плоскую форму: клиент отправляет первую, но плоская удобна для e2e-скриптов и curl.
 */
export function parseSubscription(body: Record<string, unknown>): ParseResult {
  const endpoint = body.endpoint;
  if (!isAllowedEndpoint(endpoint)) return { ok: false, error: "bad_endpoint" };

  const keys = (typeof body.keys === "object" && body.keys !== null ? body.keys : body) as
    Record<string, unknown>;
  const p256dh = b64urlBytes(keys.p256dh, 65);
  const auth = b64urlBytes(keys.auth, 16);
  if (!p256dh || !auth) return { ok: false, error: "bad_subscription" };
  // Первый байт uncompressed-точки — ключ в другой форме мы шифровать не умеем.
  if (Buffer.from(p256dh, "base64url")[0] !== 0x04) return { ok: false, error: "bad_subscription" };

  return { ok: true, value: { endpoint, p256dh, auth } };
}

/** Разобрать тело `POST /api/push/unsubscribe` — там нужен только endpoint. */
export function parseEndpointOnly(body: Record<string, unknown>): string | null {
  return isAllowedEndpoint(body.endpoint) ? body.endpoint : null;
}

/**
 * Короткий отпечаток endpoint'а — для ключей дедупа в KV и для логов.
 *
 * Сам endpoint туда попадать не должен: это capability-ссылка (кто её знает, тот может
 * присылать уведомления этому устройству от нашего имени), а логи и Redis-ключи живут дольше
 * и видны шире, чем строка в базе.
 */
export function endpointFingerprint(endpoint: string): string {
  return createHash("sha256").update(`vltr:push:${endpoint}`).digest("hex").slice(0, 24);
}

/**
 * Конфигурация фичи «веб-пуши» и отправка одного уведомления push-сервису.
 *
 * Второй канал возврата игрока (первый — Telegram-бот). Нужен потому, что у ВСЕХ игроков в
 * проде стрик = 1: никто ни разу не вернулся в 12-часовое окно. Telegram требует привязки
 * кодом и наличия самого Telegram; веб-пуш включается одной кнопкой в браузере.
 *
 * Устроено по образцу `lib/telegram.ts`:
 *  - фича за флагом и выключена ЦЕЛИКОМ, пока не задан полный набор env (половинчатая
 *    конфигурация опаснее отсутствующей: кнопка на сайте есть, а уведомления не доходят —
 *    и игрок думает, что ему просто нечего напоминать);
 *  - `pushStatus()` для `/api/health` теми же значениями `off | misconfigured | on`;
 *  - отправка НИКОГДА не бросает исключение: сбой одного push-сервиса не должен ронять
 *    прогон рассылки для остальных.
 *
 * Ключи VAPID берутся ТОЛЬКО из env и в репозитории не лежат (`docs/deployment.md`).
 */
import { cronSecretConfigured } from "./telegram";
import {
  b64uToBuf,
  encryptPushPayload,
  vapidAuthorization,
  type VapidKeys,
} from "./webpush";

/** Push-сервис не имеет права подвешивать прогон рассылки. */
const SEND_TIMEOUT_MS = 5000;

/** Дефолтный TTL: сколько сервис хранит сообщение, если устройство офлайн. */
const DEFAULT_TTL_SEC = 3600;

function envRaw(name: string): string | null {
  const v = process.env[name];
  return v && v.length > 0 ? v : null;
}

/**
 * Пара VAPID из env, если она валидна по форме. Проверка формы здесь, а не в момент
 * отправки: иначе опечатка в ключе обнаружилась бы только на первом реальном напоминании
 * (то есть у игрока), а `/api/health` рапортовал бы «on».
 */
export function vapidKeys(): VapidKeys | null {
  const publicKey = envRaw("VAPID_PUBLIC_KEY");
  const privateKey = envRaw("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return null;
  try {
    const pub = b64uToBuf(publicKey);
    const priv = b64uToBuf(privateKey);
    if (pub.length !== 65 || pub[0] !== 0x04 || priv.length !== 32) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey };
}

/**
 * Контакт владельца для push-сервисов (`sub` в VAPID-JWT). Обязателен: сервисы (в частности
 * Mozilla autopush) отвергают JWT без валидного `mailto:`/`https:` контакта с 401, и без
 * него фича молча не работала бы вообще.
 */
export function vapidSubject(): string | null {
  const s = envRaw("VAPID_SUBJECT");
  if (!s) return null;
  return s.startsWith("mailto:") || s.startsWith("https://") ? s : null;
}

/** Фича включена, только если валидны ОБА ключа, контакт и секрет планировщика. */
export function pushConfigured(): boolean {
  return vapidKeys() !== null && vapidSubject() !== null && cronSecretConfigured();
}

/** Для `/api/health` — тем же способом, что `telegramStatus()`. */
export function pushStatus(): "on" | "off" | "misconfigured" {
  // Ни одного признака настройки — фича просто не включена, это не ошибка.
  if (!envRaw("VAPID_PUBLIC_KEY") && !envRaw("VAPID_PRIVATE_KEY") && !envRaw("VAPID_SUBJECT")) {
    return "off";
  }
  return pushConfigured() ? "on" : "misconfigured";
}

/**
 * Публичный ключ для браузера (`applicationServerKey` в `pushManager.subscribe`).
 * Отдаётся роутом, а не через `NEXT_PUBLIC_*`: значение публично по своей природе, но так
 * фичу можно включить/выключить в рантайме, без пересборки бандла (`docs/deployment.md`).
 */
export function publicKeyForClient(): string | null {
  if (!pushConfigured()) return null;
  return vapidKeys()!.publicKey;
}

/** Минимум, который нужен для отправки. Формат совпадает с записью стора. */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  ok: boolean;
  /**
   * Подписка мертва окончательно (404 «нет такой подписки» / 410 Gone — игрок отозвал
   * разрешение или удалил сайт из браузера). Вызывающий код ОБЯЗАН удалить запись: иначе
   * рассылка будет долбиться в неё на каждом тике крона до конца времён — тот же контракт,
   * что и `blocked` у Telegram.
   */
  gone: boolean;
  /** 429/503: сервис просит подождать. Сообщение считается неотправленным. */
  retryAfterSec?: number;
  /** Код ответа — только для логов прогона, наружу не отдаётся. */
  status?: number;
}

/**
 * Отправить одно уведомление. Тело шифруется ключами САМОЙ подписки (RFC 8291): push-сервис
 * (Google/Mozilla/Microsoft) передаёт байты, не имея возможности их прочитать, — поэтому
 * даже нейтральный текст напоминания не становится данными, отданными третьей стороне.
 */
export async function sendWebPush(
  target: PushTarget,
  payload: string,
  ttlSec: number = DEFAULT_TTL_SEC,
  now: number = Date.now(),
): Promise<PushSendResult> {
  const keys = vapidKeys();
  const subject = vapidSubject();
  if (!keys || !subject) return { ok: false, gone: false };

  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPushPayload(payload, { p256dh: target.p256dh, auth: target.auth });
    authorization = vapidAuthorization(target.endpoint, keys, subject, now);
  } catch {
    // Битые ключи подписки шифрование не пройдут. Это не «сервис недоступен», а
    // непригодная запись: помечаем как gone, чтобы её удалили и не пытались вечно.
    return { ok: false, gone: true };
  }

  try {
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: {
        authorization,
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(Math.max(0, Math.trunc(ttlSec))),
        // Напоминание должно будить устройство: на `low` Android может отложить показ до
        // следующей активности, а весь смысл в том, чтобы игрок вернулся ДО рейдера.
        urgency: "high",
      },
      // Buffer — это Uint8Array, `fetch` принимает его как тело без копирования в строку.
      body: new Uint8Array(body),
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });

    if (res.status === 404 || res.status === 410) return { ok: false, gone: true, status: res.status };
    if (res.ok) return { ok: true, gone: false, status: res.status };
    if (res.status === 429 || res.status === 503) {
      const retryAfter = Number(res.headers.get("retry-after") ?? "");
      return {
        ok: false,
        gone: false,
        retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60,
        status: res.status,
      };
    }
    return { ok: false, gone: false, status: res.status };
  } catch {
    // Таймаут/обрыв: подписка может быть жива, удалять её нельзя.
    return { ok: false, gone: false };
  }
}

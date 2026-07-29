/**
 * Запись отказов безопасности и алерт владельцу (задача 1.5).
 *
 * Тонкая обвязка над KV: вся логика порогов, вёдер и текстов — в `lib/security-metrics.ts`
 * и покрыта тестами без Redis. Здесь только ввод-вывод.
 *
 * ГЛАВНОЕ ПРАВИЛО ЭТОГО МОДУЛЯ: он не имеет права ничего сломать. Мониторинг существует,
 * чтобы узнать об атаке, а не чтобы стать её причиной, поэтому любая ошибка KV или
 * Telegram гасится молча. Отказ роута из-за того, что не записался счётчик, — это
 * самострел: атакующему достаточно уронить Redis, чтобы уронить сайт.
 */
import { getKv } from "./kv";
import { sendTelegramMessage, telegramConfigured } from "./telegram";
import {
  BUCKET_TTL_SEC,
  alertKey,
  alertText,
  bucketOf,
  buildSnapshot,
  counterKey,
  crossedThreshold,
  snapshotKeys,
  type SecurityEvent,
  type SecuritySnapshot,
} from "./security-metrics";

/** Чат владельца для алертов. Не задан — считаем только счётчики, никого не будим. */
function adminChatId(): number | null {
  const raw = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Зафиксировать отказ. Вызывать в момент отправки 401/403/429 клиенту.
 *
 * Ничего не ждём от вызывающего кода: функция не бросает и не требует await — роут не
 * должен ни на миллисекунду задерживать ответ ради счётчика. Промах счётчика при сбое KV
 * приемлем: мониторинг — не бухгалтерия, ему достаточно порядка величины.
 */
export function noteSecurityEvent(event: SecurityEvent, now: number = Date.now()): void {
  void recordAndMaybeAlert(event, now).catch(() => {});
}

async function recordAndMaybeAlert(event: SecurityEvent, now: number): Promise<void> {
  const kv = getKv();
  // Без KV считать негде: память процесса на serverless бесполезна — запросы размазаны
  // по инстансам, и каждый счётчик начинался бы с нуля. Тот же аргумент, что у лимитера
  // (NOTES.md 2026-07-25), но здесь фолбэка в память нет вовсе: он давал бы ложное
  // чувство наблюдаемости.
  if (!kv) return;

  const bucket = bucketOf(now);
  const count = await kv.bumpCounter(counterKey(event, bucket), BUCKET_TTL_SEC);
  if (!crossedThreshold(event, count)) return;

  const chatId = adminChatId();
  if (chatId === null || !telegramConfigured()) return;

  // Второй барьер против спама поверх `crossedThreshold`: даже если счётчик почему-то
  // пересечёт порог дважды (гонка двух инстансов на одном значении), алерт уйдёт один.
  const first = await kv.setIfAbsent(alertKey(event, bucket), BUCKET_TTL_SEC);
  if (!first) return;

  await sendTelegramMessage(chatId, alertText(event, count));
}

/** Сводка для админского роута. Без KV — честные нули, а не выдуманные значения. */
export async function securitySnapshot(now: number = Date.now()): Promise<SecuritySnapshot> {
  const kv = getKv();
  if (!kv) return buildSnapshot(now, []);
  try {
    return buildSnapshot(now, await kv.getMany(snapshotKeys(now)));
  } catch {
    return buildSnapshot(now, []);
  }
}

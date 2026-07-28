/**
 * Клиент Telegram Bot API + конфигурация/статус фичи "напоминания".
 *
 * КРИТИЧНО (безопасность вебхука): Telegram шлёт апдейты обычным POST без Origin —
 * `sameOriginOk` (lib/http.ts, инвариант 8) для него не применим и НЕ ослабляется
 * глобально. Вместо этого запрос аутентифицируется секретом в заголовке
 * `X-Telegram-Bot-Api-Secret-Token` (сверяется здесь, `verifyWebhookSecret`) и тем же
 * секретом, зашитым случайным сегментом в путь роута (`verifyWebhookSecret` тоже, роут
 * app/api/telegram/webhook/[secret]/route.ts). Без секрета угадавший URL шлёт поддельные
 * апдейты и привязывает произвольные chatId к чужим аккаунтам — это ГЛАВНЫЙ контроль
 * во всей фиче.
 *
 * Секреты сравниваются через SHA-256 + timingSafeEqual (как в
 * app/api/admin/close-week/route.ts), а не прямым `===`: прямое сравнение строк выходит
 * из цикла на первом несовпавшем байте и выдаёт секрет по времени ответа.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const TELEGRAM_API_BASE = "https://api.telegram.org";
/** Бот не имеет права подвешивать вызывающий код (рассылку/вебхук) — потолок на отправку. */
const SEND_TIMEOUT_MS = 5000;

function envToken(): string | null {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  return t && t.length > 0 ? t : null;
}

/** ≥32 символов: это же значение уходит и в путь URL, и в заголовок secret_token. */
function envWebhookSecret(): string | null {
  const s = process.env.TELEGRAM_WEBHOOK_SECRET;
  return s && s.length >= 32 ? s : null;
}

/**
 * Секрет крона рассылки. Названо `CRON_SECRET`, а не `TELEGRAM_CRON_SECRET`: Vercel Cron
 * Jobs сам подставляет `Authorization: Bearer $CRON_SECRET`, если эта переменная задана в
 * проекте, — не нужно городить кастомные заголовки в vercel.json.
 */
function envCronSecret(): string | null {
  const s = process.env.CRON_SECRET;
  return s && s.length >= 16 ? s : null;
}

/**
 * Фича полностью выключена, пока не заданы ВСЕ ТРИ переменные разом.
 *
 * Половинчатая конфигурация опаснее отсутствующей: например, токен бота задан, а секрет
 * вебхука — нет, и роут пришлось бы либо держать полностью открытым, либо гадать, что
 * делать. Проще: нет полного набора — бот выключен целиком и ничего не ломает (то же
 * правило, что и у ADMIN_SECRET в close-week).
 */
export function telegramConfigured(): boolean {
  return envToken() !== null && envWebhookSecret() !== null && envCronSecret() !== null;
}

/** Для /api/health, тем же способом, что rateLimit/weekResults/authDomain. */
export function telegramStatus(): "on" | "off" | "misconfigured" {
  if (!envToken()) return "off";
  return telegramConfigured() ? "on" : "misconfigured";
}

/** Сравнение строк через хеш постоянной длины — не подвержено timing-атакам. */
function timingSafeStrEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Сверить секрет вебхука. Используется ДВАЖДЫ на один запрос: для сегмента пути (URL
 * не угадывается без секрета) и для заголовка `X-Telegram-Bot-Api-Secret-Token` (реальная
 * аутентификация запроса — см. `setWebhook`, куда этот же секрет уходит параметром
 * `secret_token`). `false`, если фича не сконфигурирована — сравнивать не с чем.
 */
export function verifyWebhookSecret(candidate: string | null | undefined): boolean {
  const secret = envWebhookSecret();
  if (!secret || !candidate) return false;
  return timingSafeStrEqual(candidate, secret);
}

/** Сверить `Authorization: Bearer <CRON_SECRET>` роута рассылки. */
export function verifyCronSecret(authorizationHeader: string | null | undefined): boolean {
  const secret = envCronSecret();
  if (!secret) return false;
  const header = authorizationHeader ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  return timingSafeStrEqual(token, secret);
}

export interface SendResult {
  ok: boolean;
  /**
   * Telegram ответил 403 "Forbidden: bot was blocked by the user" — единственный сигнал,
   * означающий, что достучаться до чата больше физически нельзя. Вызывающий код ОБЯЗАН
   * удалить привязку сам (см. lib/telegram-remind.ts), иначе рассылка будет бесконечно
   * долбиться в заблокировавшего игрока на каждом тике крона.
   */
  blocked: boolean;
  /** Присутствует при 429 — сколько секунд Telegram просит подождать. */
  retryAfterSec?: number;
}

/**
 * Отправить текстовое сообщение. Никогда не бросает исключение — вызывающий код (рассылка,
 * вебхук) не должен падать из-за сетевого сбоя Telegram; ошибка просто означает
 * "сообщение не ушло", и это не блокирует остальную логику (привязку, отписку).
 */
export async function sendTelegramMessage(chatId: number, text: string): Promise<SendResult> {
  const token = envToken();
  if (!token) return { ok: false, blocked: false };
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (res.ok) return { ok: true, blocked: false };
    if (res.status === 403) return { ok: false, blocked: true };
    if (res.status === 429) {
      const body = (await res.json().catch(() => null)) as
        | { parameters?: { retry_after?: number } }
        | null;
      const retryAfter = body?.parameters?.retry_after;
      return {
        ok: false,
        blocked: false,
        retryAfterSec: typeof retryAfter === "number" ? retryAfter : 1,
      };
    }
    return { ok: false, blocked: false };
  } catch {
    return { ok: false, blocked: false };
  }
}

/** URL вебхука, который передаётся в `setWebhook` и который обслуживает наш роут. */
export function webhookUrl(siteUrl: string): string {
  const secret = envWebhookSecret();
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET не задан");
  return `${siteUrl.replace(/\/+$/, "")}/api/telegram/webhook/${secret}`;
}

/**
 * Зарегистрировать вебхук в Telegram. Дёргается ТОЛЬКО из `scripts/telegram-setup.mjs`,
 * который запускает владелец после создания бота в BotFather и заполнения env —
 * сам по себе этот вызов не создаёт ни бота, ни аккаунта.
 */
export async function setWebhook(
  siteUrl: string,
): Promise<{ ok: boolean; description?: string }> {
  const token = envToken();
  const secret = envWebhookSecret();
  if (!token || !secret) {
    return { ok: false, description: "TELEGRAM_BOT_TOKEN/TELEGRAM_WEBHOOK_SECRET не заданы" };
  }
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl(siteUrl),
      secret_token: secret,
      // Апдейты, накопленные до перевыпуска секрета, нам не нужны — это не команды игроков.
      drop_pending_updates: true,
      allowed_updates: ["message"],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
  return { ok: data.ok === true, description: data.description };
}

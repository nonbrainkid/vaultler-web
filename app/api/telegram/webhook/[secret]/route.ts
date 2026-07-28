/**
 * POST /api/telegram/webhook/[secret] — приём апдейтов от Telegram.
 *
 * САМОЕ УЯЗВИМОЕ МЕСТО ВСЕЙ ФИЧИ (docs/brief-engineer.md). Без строгой проверки любой,
 * кто угадал (или увидел в логах) URL, шлёт СВОИ поддельные апдейты — например,
 * `{"message":{"chat":{"id":<chat жертвы>,"type":"private"},"text":"/start <чужой код>"}}` —
 * и привязывает произвольный chatId к произвольному аккаунту. Поэтому здесь ДВА
 * независимых контроля, и оба обязательны:
 *
 *  1. Сегмент пути `[secret]` — случайный, из env: URL просто не угадать перебором.
 *  2. Заголовок `X-Telegram-Bot-Api-Secret-Token` — Telegram прикладывает его сам на
 *     КАЖДЫЙ вызов, потому что мы передали `secret_token` в `setWebhook`
 *     (lib/telegram.ts). Это и есть настоящая аутентификация запроса.
 *
 * Оба сравниваются с ОДНИМ И ТЕМ ЖЕ значением `TELEGRAM_WEBHOOK_SECRET` через
 * SHA-256 + timingSafeEqual (`verifyWebhookSecret`), а не строковым `===`. При провале —
 * 404, а не 401/403: код ответа не должен подсказывать угадывающему путь, что он на
 * верном напрвлении (401 подтвердил бы "путь существует, но не тот секрет").
 *
 * ИНВАРИАНТ 8 (sameOriginOk на каждом POST) ЗДЕСЬ НЕ ПРИМЕНИМ И НЕ ОСЛАБЛЯЕТСЯ ГЛОБАЛЬНО:
 * у серверного запроса от Telegram нет заголовка Origin в принципе — это ожидаемо, а не
 * признак атаки. Вместо него аутентификация идёт секретом выше. Это единственное,
 * явное и прокомментированное исключение из инварианта; сам `sameOriginOk()` в
 * lib/http.ts никак не менялся.
 *
 * БОТ НЕ МУТИРУЕТ ИГРОВОЙ СТЕЙТ: единственная запись, которую делает этот роут, —
 * `store.linkTelegram` / `store.unlinkTelegramByChatId`, обе про привязку чата, а не про
 * стек/стрик/буст. Ни одного вызова `crank`/`settle`-с-персистом здесь нет.
 */
import { NextRequest } from "next/server";
import { jsonNoStore, readJsonBody } from "@/lib/http";
import { getKv } from "@/lib/kv";
import { allowTelegramWebhook } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { completeLink } from "@/lib/telegram-link";
import { sendTelegramMessage, verifyWebhookSecret } from "@/lib/telegram";
import {
  helpText,
  invalidOrExpiredCodeText,
  linkMovedNoticeText,
  linkedConfirmationText,
  notLinkedText,
  privateChatOnlyText,
  unlinkedConfirmationText,
} from "@/lib/telegram-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface TelegramUpdate {
  update_id: number;
  message?: {
    chat: { id: number; type: string };
    text?: string;
  };
}

/** Дедуп по update_id: Telegram ретраит доставку, если мы не ответили вовремя. */
const UPDATE_DEDUP_TTL_SEC = 24 * 60 * 60;
const seenUpdatesFallback = new Map<number, number>();

/** true — этот update_id уже обрабатывался (дубль ретрая), false — новый. */
async function alreadySeen(updateId: number, now: number): Promise<boolean> {
  const key = `vltr:tgwh:seen:${updateId}`;
  const kv = getKv();
  if (kv) {
    try {
      // setIfAbsent → true значит "не было", т.е. это первый раз — инвертируем.
      return !(await kv.setIfAbsent(key, UPDATE_DEDUP_TTL_SEC));
    } catch {
      // KV недоступен — падаем на память процесса ниже, лучше лишний раз обработать,
      // чем зависнуть на недоступном сторе (тот же компромисс, что в lib/ratelimit.ts).
    }
  }
  const exp = seenUpdatesFallback.get(updateId);
  if (exp !== undefined && exp > now) return true;
  seenUpdatesFallback.set(updateId, now + UPDATE_DEDUP_TTL_SEC * 1000);
  if (seenUpdatesFallback.size > 5000) {
    for (const [k, e] of seenUpdatesFallback) if (e <= now) seenUpdatesFallback.delete(k);
  }
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ secret: string }> },
) {
  const { secret } = await params;

  if (
    !verifyWebhookSecret(secret) ||
    !verifyWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))
  ) {
    return new Response(null, { status: 404 });
  }

  // Тот же потолок размера тела, что и у остальных POST (lib/http.ts) — Telegram Update
  // для текстовых сообщений на порядки меньше 16 КБ, урезание не мешает штатной работе.
  const body = await readJsonBody(req);
  if (!body.ok) return jsonNoStore({ ok: true }); // Telegram не переспрашивает по коду ответа

  const update = body.value as unknown as TelegramUpdate;
  if (typeof update.update_id !== "number") return jsonNoStore({ ok: true });

  const now = Date.now();
  if (await alreadySeen(update.update_id, now)) return jsonNoStore({ ok: true });

  const message = update.message;
  if (!message || typeof message.text !== "string") return jsonNoStore({ ok: true });

  const chatId = message.chat.id;
  if (!Number.isFinite(chatId)) return jsonNoStore({ ok: true });

  if (!(await allowTelegramWebhook(String(chatId), now))) return jsonNoStore({ ok: true });

  const text = message.text.trim();
  const isPrivate = message.chat.type === "private";

  if (text.startsWith("/start")) {
    // Привязка ТОЛЬКО из приватного чата — иначе игровые данные (стек, стрик) поедут
    // в чужой групповой чат, где их видят все участники группы.
    if (!isPrivate) {
      await sendTelegramMessage(chatId, privateChatOnlyText());
      return jsonNoStore({ ok: true });
    }
    const code = text.slice("/start".length).trim();
    if (!code) {
      await sendTelegramMessage(chatId, helpText());
      return jsonNoStore({ ok: true });
    }

    const store = await getStore();
    const outcome = await completeLink(store, chatId, code, now);
    if (!outcome.ok) {
      await sendTelegramMessage(chatId, invalidOrExpiredCodeText());
      return jsonNoStore({ ok: true });
    }
    // 1:1 в обе стороны: если у identity уже была привязка к ДРУГОМУ чату — этот старый
    // чат получает уведомление о переносе, иначе человек ждал бы напоминаний в мёртвый чат.
    if (outcome.displacedChatId !== null) {
      await sendTelegramMessage(outcome.displacedChatId, linkMovedNoticeText());
    }
    await sendTelegramMessage(chatId, linkedConfirmationText());
    return jsonNoStore({ ok: true });
  }

  if (text === "/stop") {
    if (!isPrivate) return jsonNoStore({ ok: true }); // групповые чаты не привязываются вовсе
    const store = await getStore();
    const identity = await store.unlinkTelegramByChatId(chatId);
    await sendTelegramMessage(chatId, identity !== null ? unlinkedConfirmationText() : notLinkedText());
    return jsonNoStore({ ok: true });
  }

  // Любой другой текст: отвечаем шпаргалкой только в приватном чате — в группе бот
  // должен молчать на обычный шум, а не превращаться в спамера.
  if (isPrivate) {
    await sendTelegramMessage(chatId, helpText());
  }
  return jsonNoStore({ ok: true });
}

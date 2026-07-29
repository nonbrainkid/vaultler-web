/**
 * POST /api/telegram/unlink — кнопка отписки на сайте.
 *
 * Требование задания: "отписка (/stop в боте И кнопка на сайте) физически удаляет
 * привязку, а не ставит флаг". Здесь и в вебхуке используется один и тот же метод стора
 * (`unlinkTelegramByIdentity` / `unlinkTelegramByChatId`), который правда удаляет строку,
 * а не выставляет `active: false` — иначе "отписался" и "никогда не привязывался" были бы
 * неотличимы для будущего аудита, а бот продолжал бы технически иметь chatId в базе.
 */
import { NextRequest } from "next/server";
import { noteSecurityEvent } from "@/lib/security-log";
import { jsonNoStore, resolveIdentity, sameOriginOk } from "@/lib/http";
import { allowTelegramLink } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { sendTelegramMessage } from "@/lib/telegram";
import { unlinkedConfirmationText } from "@/lib/telegram-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req)) {
    noteSecurityEvent("bad_origin");
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }

  const identity = await resolveIdentity(req);
  if (!(await allowTelegramLink(identity, Date.now()))) {
    noteSecurityEvent("rate_limited");
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const store = await getStore();
  const chatId = await store.unlinkTelegramByIdentity(identity);

  // Уведомление — лучшее старание: даже если Telegram недоступен, привязка уже удалена
  // (она первична), а сообщение — просто вежливость.
  if (chatId !== null) {
    await sendTelegramMessage(chatId, unlinkedConfirmationText());
  }

  return jsonNoStore({ ok: true, linked: false });
}

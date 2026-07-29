/**
 * GET/POST /api/telegram/link — статус привязки и выдача одноразового кода.
 *
 * Сама привязка (identity ↔ chatId) НЕ происходит здесь — она происходит в вебхуке
 * (app/api/telegram/webhook/[secret]/route.ts), когда бот получает `/start <код>` от
 * Telegram. Этот роут только сообщает "привязан ли я" и выдаёт код ВЛАДЕЛЬЦУ ТЕКУЩЕЙ
 * СЕССИИ — identity берётся из resolveIdentity(), как и везде (инвариант 6), а не из
 * какого-либо поля тела запроса. Анонимные сессии (без кошелька) обслуживаются наравне
 * с кошельковыми — это осознанное решение (docs/brief-engineer.md → 1.1).
 */
import { NextRequest } from "next/server";
import { noteSecurityEvent } from "@/lib/security-log";
import { jsonNoStore, resolveIdentity, sameOriginOk } from "@/lib/http";
import { allowTelegramLink } from "@/lib/ratelimit";
import { getStore } from "@/lib/store";
import { issueLinkCode, toLinkStatusView } from "@/lib/telegram-link";
import { telegramConfigured } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!telegramConfigured()) {
    // Фича за флагом: без env бот выключен целиком, а не наполовину.
    return jsonNoStore({ configured: false, linked: false });
  }
  const identity = await resolveIdentity(req);
  const store = await getStore();
  const chatId = await store.telegramChatIdFor(identity);
  // chatId используется только чтобы посчитать boolean — наружу он не уходит НИКОГДА
  // (тот же инвариант 5, что и для internal id / скрытого адреса кошелька), см.
  // toLinkStatusView и lib/telegram-link.test.ts.
  return jsonNoStore({ configured: true, ...toLinkStatusView(chatId) });
}

export async function POST(req: NextRequest) {
  // Ответ содержит одноразовый код — чужая страница не должна суметь выманить его
  // CSRF-запросом от имени залогиненной жертвы. Cross-origin fetch и так не читает тело
  // без CORS, но проверка происхождения — по конвенции проекта на каждом POST.
  if (!sameOriginOk(req)) {
    noteSecurityEvent("bad_origin");
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }
  if (!telegramConfigured()) {
    return jsonNoStore({ error: "not_configured" }, { status: 503 });
  }

  const identity = await resolveIdentity(req);
  if (!(await allowTelegramLink(identity, Date.now()))) {
    noteSecurityEvent("rate_limited");
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const issued = await issueLinkCode(identity, Date.now());
  // Username бота НЕ отдаём в ответе: клиент собирает deep link из той же константы
  // `TELEGRAM_BOT_USERNAME` (lib/links.ts), что и ссылка "REMINDER BOT" в шапке/футере.
  // Если бы значения шли по двум разным путям, они могли бы разойтись, а несовпадающая
  // ссылка на "официального" бота — ровно то, чем маскируются клоны-дрейнеры.
  return jsonNoStore({ ok: true, code: issued.code, expiresInSec: issued.expiresInSec });
}

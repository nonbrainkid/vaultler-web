/**
 * POST /api/telegram/remind — рассылка напоминаний по расписанию.
 *
 * Защита: `Authorization: Bearer <CRON_SECRET>`, сверяется через SHA-256 + timingSafeEqual
 * (тот же паттерн, что app/api/admin/close-week/route.ts). Это ЕДИНСТВЕННЫЙ барьер:
 * планировщик внешний (см. ниже), поэтому роут доступен из интернета кому угодно, и без
 * секрета любой, кто узнал URL, триггерит массовую рассылку от нашего имени.
 *
 * ПЛАНИРОВЩИК — GitHub Actions (`.github/workflows/reminders.yml`), а НЕ Vercel Cron:
 * проект на плане Hobby, где крон Vercel запускается не чаще раза в сутки (±59 мин) —
 * непригодно для окна "2 часа до рейдера", а `crons` в vercel.json с более частым
 * расписанием на Hobby ломает сам деплой. Переезд на нативный Vercel Cron возможен только
 * после апгрейда на Pro (docs/deployment.md). Секрет прокидывается workflow'ом из GitHub
 * Secrets явным заголовком — Vercel здесь ничего не подставляет сам.
 *
 * ТИК НЕ ТОЧНЫЙ: GitHub Actions по расписанию может сработать с задержкой до 10–20 минут.
 * Поэтому роут не полагается на то, что его позвали ровно вовремя, — он выбирает ВСЕХ, у
 * кого нужное событие уже наступило (`dueReminders`, чистая функция от текущего `now`,
 * lib/telegram-remind.ts). Из-за этого идемпотентность по `(identity, lastCrankAt, kind)`
 * не опция, а обязательное условие: сдвоенный или запоздавший тик не должен прислать одно
 * и то же напоминание дважды.
 *
 * БОТ НЕ МУТИРУЕТ ИГРОВОЙ СТЕЙТ: `settle()` вызывается только В ПАМЯТИ (как в
 * GET /api/state и buildLeaderboard) — ни одного `store.mutate` здесь нет.
 */
import { NextRequest } from "next/server";
import { settle } from "@/lib/game";
import { jsonNoStore } from "@/lib/http";
import { getStore } from "@/lib/store";
import { sendTelegramMessage, telegramConfigured, verifyCronSecret } from "@/lib/telegram";
import { raidWarningText, windowOpenText } from "@/lib/telegram-copy";
import { dueReminders, reserveReminder, runReminders } from "@/lib/telegram-remind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!telegramConfigured()) {
    return jsonNoStore({ error: "not_configured" }, { status: 503 });
  }
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return jsonNoStore({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const store = await getStore();

  // Ровно те же источники, что читает борд (lib/leaderboard.ts) и close-week: снапшот
  // всех игроков плюс их привязки чата. Никакой отдельной "теневой" копии стейта.
  const [snapshot, links] = await Promise.all([store.snapshot(), store.telegramLinks()]);
  const chatIdByIdentity = new Map(links.map((l) => [l.identity, l.chatId]));

  // settle() ТОЛЬКО в памяти, без персиста — read-only использование, как в /api/state.
  const live = snapshot.map((p) => ({
    identity: p.identity,
    state: settle(p.state, now).state,
  }));

  const due = dueReminders(live, chatIdByIdentity, now);

  const summary = await runReminders(due, now, {
    reserve: reserveReminder,
    send: (chatId, kind) =>
      sendTelegramMessage(chatId, kind === "window_open" ? windowOpenText() : raidWarningText()),
    unlink: async (chatId) => {
      await store.unlinkTelegramByChatId(chatId);
    },
  });

  return jsonNoStore({ ok: true, due: due.length, ...summary });
}

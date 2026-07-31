/**
 * POST /api/telegram/remind — рассылка напоминаний по расписанию. ОБА КАНАЛА: Telegram-бот
 * и веб-пуши (PWA).
 *
 * Почему путь по-прежнему `/api/telegram/remind`, хотя канала теперь два: этот URL — контракт
 * с планировщиком (`.github/workflows/reminders.yml` + `CRON_SECRET` в GitHub Secrets).
 * Переименование потребовало бы менять workflow и секрет одновременно, и на время
 * рассинхронизации напоминания перестали бы уходить вообще — ровно та поломка, которую эта
 * фича должна лечить. Один тик = один запрос = оба канала.
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
 * кого нужное событие уже наступило (`dueKinds`, чистая функция от текущего `now`,
 * lib/reminders.ts). Из-за этого идемпотентность (у Telegram по `(identity, lastCrankAt,
 * kind)`, у пушей по `(endpoint, lastCrankAt, kind)`) не опция, а обязательное условие:
 * сдвоенный или запоздавший тик не должен прислать одно и то же напоминание дважды.
 *
 * НИ ОДИН КАНАЛ НЕ МУТИРУЕТ ИГРОВОЙ СТЕЙТ: `settle()` вызывается только В ПАМЯТИ (как в
 * GET /api/state и buildLeaderboard) — ни одного `store.mutate` здесь нет.
 */
import { NextRequest } from "next/server";
import { settle } from "@/lib/game";
import { jsonNoStore } from "@/lib/http";
import { pushConfigured, sendWebPush } from "@/lib/push";
import { pushNotification, pushPayload } from "@/lib/push-copy";
import { duePushReminders, reservePush, runPushReminders } from "@/lib/push-remind";
import { getStore } from "@/lib/store";
import { sendTelegramMessage, telegramConfigured, verifyCronSecret } from "@/lib/telegram";
import { raidWarningText, windowOpenText } from "@/lib/telegram-copy";
import { dueReminders, reserveReminder, runReminders } from "@/lib/telegram-remind";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const telegramOn = telegramConfigured();
  const pushOn = pushConfigured();
  if (!telegramOn && !pushOn) {
    // Ни один канал не настроен — рассылать нечем. Отдельные каналы независимы: включённый
    // бот не требует VAPID-ключей и наоборот.
    return jsonNoStore({ error: "not_configured" }, { status: 503 });
  }
  if (!verifyCronSecret(req.headers.get("authorization"))) {
    return jsonNoStore({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const store = await getStore();

  // Ровно те же источники, что читает борд (lib/leaderboard.ts) и close-week: снапшот
  // всех игроков плюс адреса доставки. Никакой отдельной "теневой" копии стейта.
  const [snapshot, links, pushSubs] = await Promise.all([
    store.snapshot(),
    telegramOn ? store.telegramLinks() : Promise.resolve([]),
    pushOn ? store.pushSubscriptions() : Promise.resolve([]),
  ]);
  const chatIdByIdentity = new Map(links.map((l) => [l.identity, l.chatId]));

  // settle() ТОЛЬКО в памяти, без персиста — read-only использование, как в /api/state.
  const live = snapshot.map((p) => ({
    identity: p.identity,
    state: settle(p.state, now).state,
  }));

  const due = dueReminders(live, chatIdByIdentity, now);
  const telegram = await runReminders(due, now, {
    reserve: reserveReminder,
    send: (chatId, kind) =>
      sendTelegramMessage(chatId, kind === "window_open" ? windowOpenText() : raidWarningText()),
    unlink: async (chatId) => {
      await store.unlinkTelegramByChatId(chatId);
    },
  });

  const duePush = duePushReminders(live, pushSubs, now);
  const push = await runPushReminders(duePush, now, {
    reserve: reservePush,
    send: (target) =>
      sendWebPush(target, pushPayload(target.kind), pushNotification(target.kind).ttlSec, now),
    // 404/410 от push-сервиса или исчерпанные попытки: адрес доставки удаляется физически.
    drop: async (endpoint) => {
      await store.deletePushSubscriptionByEndpoint(endpoint);
    },
    noteResult: (endpoint, ok) => store.notePushResult(endpoint, ok),
  });

  // Сводка раздельно по каналам: «пуши не уходят, а Telegram уходит» должно быть видно из
  // одного ответа, иначе отладка сводится к угадыванию. `due` сверху — суммарное число
  // событий к отправке: этот ключ читает e2e-скрипт и лог workflow, и ломать его не за что.
  return jsonNoStore({
    ok: true,
    due: due.length + duePush.length,
    telegram: { due: due.length, ...telegram },
    push: { due: duePush.length, ...push },
  });
}

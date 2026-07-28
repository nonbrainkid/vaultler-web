#!/usr/bin/env node
/**
 * Разовая регистрация вебхука Telegram-бота. Запускает ВЛАДЕЛЕЦ, вручную, после того как:
 *
 *   1) создал бота в @BotFather (владелец аккаунта — не автоматизируется отсюда) и
 *      получил TELEGRAM_BOT_TOKEN;
 *   2) сгенерировал TELEGRAM_WEBHOOK_SECRET (openssl rand -hex 32, ≥32 симв.) и
 *      CRON_SECRET (openssl rand -base64 32, ≥16 симв.);
 *   3) выставил TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / CRON_SECRET (+ опционально
 *      NEXT_PUBLIC_TELEGRAM_BOT_USERNAME) в env Vercel и передеплоил прод.
 *
 * Сам скрипт НИЧЕГО не создаёт (ни бота, ни аккаунта, ни организации) — только
 * регистрирует URL вебхука в уже существующем боте через Telegram Bot API. Дёргать его
 * можно сколько угодно раз (setWebhook идемпотентен со стороны Telegram).
 *
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *     node scripts/telegram-setup.mjs https://thevaultler.fun
 */
import { setWebhook, webhookUrl } from "../lib/telegram.ts";

const siteUrl = process.argv[2] || process.env.NEXT_PUBLIC_SITE_URL;
if (!siteUrl) {
  console.error(
    "Укажи домен сайта (аргументом или NEXT_PUBLIC_SITE_URL):\n" +
      "  node scripts/telegram-setup.mjs https://thevaultler.fun",
  );
  process.exit(2);
}
if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
  console.error("TELEGRAM_BOT_TOKEN и TELEGRAM_WEBHOOK_SECRET должны быть в окружении.");
  process.exit(2);
}

console.log("Регистрирую вебхук:", webhookUrl(siteUrl));
const result = await setWebhook(siteUrl);

if (!result.ok) {
  console.error("✗ setWebhook не удался:", result.description ?? "(без описания)");
  process.exit(1);
}

console.log("✓ Вебхук зарегистрирован.");
console.log(
  "Проверить: curl https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo",
);

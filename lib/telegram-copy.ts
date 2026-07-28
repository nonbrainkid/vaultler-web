/**
 * Тексты сообщений Telegram-бота напоминаний.
 *
 * Чистый модуль без побочных эффектов — только строки. Держим отдельно от `lib/telegram.ts`
 * (HTTP-клиент), чтобы гардрейлы копирайтинга (docs/brief-community.md) проверялись
 * юнит-тестом без сети: "не обещаем APY/доходность, не намекаем на депозиты/стейкинг,
 * никогда не пишем первыми игроку, которого не просили" (последнее не применимо к
 * напоминаниям — это единственный исходящий канал, на который игрок подписался сам,
 * отправив /start).
 *
 * В каждом сообщении, которое бот шлёт САМ (не в ответ на явную команду), есть строка,
 * что бот ничего не просит — задание прямо требует это как защиту от фишинга под видом
 * "официального" сообщения проекта.
 */

const DISCLAIMER =
  "This bot never asks for your seed phrase, a wallet signature, or a transfer. It only sends text.";

const SITE = "thevaultler.fun";

/** Окно открылось — шаблон из docs/brief-community.md, адаптированный под бота. */
export function windowOpenText(): string {
  return [
    "🔓 THE WINDOW IS OPEN",
    "",
    "Your machine ran all night. Now it wants a turn.",
    "Crank within 12 hours → streak +1, multiplier up.",
    "Miss it → the raider takes 15%.",
    "",
    SITE,
    "",
    DISCLAIMER,
  ].join("\n");
}

/** 2 часа до рейдера — второй шаблон из того же документа. */
export function raidWarningText(): string {
  return [
    "⏰ 2 HOURS TO THE RAIDER",
    "",
    "He doesn't care about your bags. He cares that you were late.",
    `Crank now → ${SITE}`,
    "",
    DISCLAIMER,
  ].join("\n");
}

/** Подтверждение успешной привязки — первое сообщение, которое видит новый чат. */
export function linkedConfirmationText(): string {
  return [
    "✅ LINKED",
    "",
    "You'll get a nudge when your window opens and a warning before the raider comes.",
    "Send /stop anytime to unlink — that deletes the link, it doesn't just mute it.",
    "",
    DISCLAIMER,
  ].join("\n");
}

/**
 * Уведомление СТАРОМУ чату при переносе привязки на новый.
 * Отправляется, только если у identity уже был другой chatId (см. lib/telegram-link.ts).
 */
export function linkMovedNoticeText(): string {
  return [
    "🔀 THIS LINK WAS MOVED",
    "",
    "Reminders for this Vaultler account now go to a different Telegram chat.",
    "If that wasn't you, no action is needed — this chat is simply no longer linked.",
  ].join("\n");
}

/** Ответ на /stop и на кнопку отписки на сайте. */
export function unlinkedConfirmationText(): string {
  return [
    "🔕 UNLINKED",
    "",
    `Reminders are off and the link is deleted. Get a new code on ${SITE} anytime.`,
  ].join("\n");
}

/** /stop без активной привязки — не обманываем, что что-то отвязали. */
export function notLinkedText(): string {
  return `This chat wasn't linked to a Vaultler account, so there's nothing to unlink. Get a code on ${SITE} to link one.`;
}

/** Привязка требует приватного чата — иначе игровые данные ушли бы в группу. */
export function privateChatOnlyText(): string {
  return [
    "This only works in a private chat with the bot — a group would mix up whose reminders are whose.",
    `Open a DM with this bot and send /start with the code from ${SITE}.`,
  ].join("\n");
}

/** Код не найден: протух (10 мин), уже использован или просто неверный. */
export function invalidOrExpiredCodeText(): string {
  return [
    "That code is invalid or expired (codes last 10 minutes and work once).",
    `Get a fresh one on ${SITE} and send /start again with it.`,
  ].join("\n");
}

/** /start без кода и любой нераспознанный текст. */
export function helpText(): string {
  return [
    "VAULTLER reminders bot.",
    "",
    `/start <code> — link this chat using the one-time code from ${SITE}`,
    "/stop — unlink and delete this chat's link",
    "",
    DISCLAIMER,
  ].join("\n");
}

/**
 * Тексты и полезная нагрузка веб-пушей.
 *
 * Чистый модуль без побочных эффектов — как `lib/telegram-copy.ts`, и по той же причине:
 * гардрейлы копирайтинга (docs/brief-community.md, docs/frontend.md) проверяются юнит-тестом
 * без сети — «не обещаем APY и доходность, не намекаем на депозиты и кастодию».
 *
 * ЧЕГО В ПАЙЛОАДЕ НЕТ НАМЕРЕННО: ника, адреса, размера стека, стрика, места на борде — вообще
 * ничего персонального. Причины две. Первая: уведомление всплывает на экране блокировки,
 * который видят все, кто рядом. Вторая: endpoint подписки — это capability-ссылка, и если он
 * когда-нибудь утечёт (лог браузерного расширения, чужое устройство), максимум, что получит
 * посторонний, — тот же текст, что видят все остальные игроки. Текст одинаков для всех, и это
 * свойство защиты, а не лень копирайтера.
 */
import type { ReminderKind } from "./reminders";

export interface PushNotification {
  title: string;
  body: string;
  /** Куда вести по клику. Относительный путь: домен подставит сам браузер. */
  url: string;
  /**
   * Тег группировки. Одинаковый в пределах вида — повторная доставка (сервис ретраит,
   * тик крона сдвоился) ЗАМЕНИТ уведомление, а не положит второе рядом.
   */
  tag: string;
  /**
   * Сколько push-сервис хранит сообщение, если устройство офлайн. Для предупреждения о
   * рейдере срок короткий осознанно: доставленное после рейда, оно врёт игроку о том, что
   * ещё можно успеть.
   */
  ttlSec: number;
}

const WINDOW_OPEN: PushNotification = {
  title: "🔓 The window is open",
  body: "Crank within 12 hours → streak +1. Miss it → the raider takes 15%.",
  url: "/",
  tag: "vltr-window",
  ttlSec: 4 * 60 * 60,
};

const RAID_WARNING: PushNotification = {
  title: "⏰ 2 hours to the raider",
  body: "He doesn't care about your bags. He cares that you were late. Crank now.",
  url: "/",
  tag: "vltr-raid",
  ttlSec: 2 * 60 * 60,
};

export function pushNotification(kind: ReminderKind): PushNotification {
  return kind === "window_open" ? WINDOW_OPEN : RAID_WARNING;
}

/**
 * Полезная нагрузка для service worker'а. JSON, а не сырой текст: SW должен разобрать
 * заголовок и тело отдельно, а разбирать текст по разделителю — способ однажды показать
 * игроку сырую строку с разделителем.
 */
export function pushPayload(kind: ReminderKind): string {
  const n = pushNotification(kind);
  return JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag });
}

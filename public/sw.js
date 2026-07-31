/**
 * Service worker VAULTLER: показ веб-пушей и открытие сайта по клику.
 *
 * Границы, за которые этот файл не выходит:
 *  1. НИЧЕГО НЕ КЭШИРУЕТ. Обработчик `fetch` есть (без него браузеры не считают сайт
 *     устанавливаемым приложением), но он не перехватывает ответы. Причина в инварианте 7
 *     проекта: ответы сайта персональны (стек, ник, Set-Cookie с сессией). Кэш в service
 *     worker'е живёт дольше сессии и общий на весь браузер — закешированный HTML или ответ
 *     /api/state показал бы следующему пользователю этого устройства чужие данные.
 *  2. НЕ ЗНАЕТ ИГРОВОЙ ЛОГИКИ. Всё, что тут есть, — заголовок и текст из payload'а, который
 *     прислал сервер. Стек и стрик считает сервер (главный инвариант проекта), а уведомление
 *     ничего не начисляет и не отправляет обратно.
 *  3. НИЧЕГО НЕ ЗАГРУЖАЕТ извне: ни importScripts, ни eval, ни сторонних доменов. Иначе
 *     компромисс любого CDN превратился бы в постоянный код на нашем origin — service worker
 *     живёт после закрытия вкладки.
 *
 * Файл лежит в `public/` и раздаётся как `/sw.js` — со scope `/`, иначе он не смог бы
 * управлять страницей на корне сайта.
 */

/** Куда вести, если сервер по какой-то причине не прислал url. */
const FALLBACK_URL = "/";

self.addEventListener("push", (event) => {
  // Пуш без данных технически возможен (сервис может доставить пустое тело) — тогда
  // показываем нейтральный текст, а не молчим: разрешение уже дано, и молчание выглядит
  // как сломанные напоминания.
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = {};
    }
  }

  const title = typeof payload.title === "string" ? payload.title : "VAULTLER";
  const body = typeof payload.body === "string" ? payload.body : "Your machine wants a turn.";
  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : FALLBACK_URL;
  const tag = typeof payload.tag === "string" ? payload.tag : "vltr";

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // Иконки — свои же роуты (app/icon.tsx, app/apple-icon.tsx): сторонних доменов в
      // уведомлении быть не должно.
      icon: "/apple-icon",
      badge: "/icon",
      tag,
      // Уведомление заменяет предыдущее с тем же тегом молча: повторный тик крона не должен
      // ещё раз вибрировать телефон.
      renotify: false,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || FALLBACK_URL;

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Если сайт уже открыт — фокусируем существующую вкладку, а не плодим новые: игрок
      // жмёт напоминание каждый день, и через неделю у него было бы семь вкладок игры.
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/**
 * Пустой обработчик `fetch` — только чтобы браузер считал приложение устанавливаемым.
 * `respondWith` не вызывается сознательно: запрос уходит в сеть как обычно, никакого кэша
 * персональных ответов не появляется (см. п.1 выше).
 */
self.addEventListener("fetch", () => {});

// Новая версия воркера начинает управлять страницами сразу, не ожидая закрытия всех вкладок.
// Иначе исправление в этом файле доезжало бы до игрока через дни, а откатить сломанный
// воркер быстро было бы нельзя.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

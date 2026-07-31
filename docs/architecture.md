# Архитектура

Как устроен проект целиком: слои, границы доверия, потоки данных, карта файлов.

## Один принцип, из которого следует всё остальное

**Сервер — источник правды.** Стек, стрик, тайминги, буст и ранг считаются и хранятся
на сервере. Клиент только рисует то, что сервер прислал.

Причина: лидерборд делит реальные токены. В прототипе (`reference/vaultler-minigame.html`)
состояние жило в `window.storage` — любой мог выставить `S.total = 999999` через DevTools
и забрать призовой пул. Поэтому вся математика петли — чистые функции в `lib/game.ts`,
время только серверное (`Date.now()` в роуте), клиентские значения не принимаются никогда.

Практические следствия, которые нельзя ломать:
- клиент не передаёт в API ни `now`, ни `stack`, ни `boost` — API их не читает;
- клиентская экстраполяция стека (`Vault.tsx`) — чистая косметика между поллами,
  на следующем ответе сервера она затирается;
- новый эндпоинт, меняющий стейт, обязан идти через `store.mutate` (атомарность).

## Слои

```
браузер                    edge                     node (API-роуты)          данные
─────────────────────────  ──────────────────────   ───────────────────────   ──────────────
app/**/*.tsx (React 19)    proxy.ts                 app/api/**/route.ts       lib/store.ts
  ↓ fetch                    · сессия (cookie)        ↓                         ├─ store-file
GET /api/state (2.5с)        · CSP + nonce          lib/game.ts (чистая)        └─ store-prisma
POST /api/crank              · x-vaultler-id        lib/leaderboard.ts             ↓
GET /api/leaderboard (8с)                           lib/vltr.ts → RPC          .data/players.json
                                                                                 / Postgres
```

- **`proxy.ts`** (бывший middleware, Next 16) — единственная точка, где выдаётся
  идентичность и CSP-nonce. Работает на всех навигациях и `/api`, кроме статики Next.
- **API-роуты** — тонкие: резолв идентичности → rate-limit → вызов чистой функции →
  `store.mutate` → JSON. Бизнес-логики в роутах нет.
- **`lib/`** — вся логика. Чистые модули (`game`, `leaderboard`, `skins`, `profile`)
  не читают ни время, ни env-состояние в рантайме и покрыты юнит-тестами.
- **Стор** — абстракция за интерфейсом `Store`; реализация выбирается по `DATABASE_URL`.

## Границы доверия

| Граница | Что проверяется | Где |
|---|---|---|
| браузер → API | подпись cookie сессии (HMAC), rate-limit по IP/идентичности | `lib/session.ts`, `lib/ratelimit.ts` |
| кошелёк → сервер | SIWE: домен, nonce, срок, подпись | `app/api/auth/verify/route.ts` |
| сервер → блокчейн | только чтение публичного баланса, транзакций нет | `lib/vltr.ts` |
| сервер → браузер | наружу не уходят internal id (`dev:…`, `wallet:0x…`) и адрес скрывшего игрока | `lib/leaderboard.ts` |
| Telegram → сервер | хеш секрета в пути URL **и** сам секрет в заголовке `X-Telegram-Bot-Api-Secret-Token` — разные значения (не `Origin`: у вебхука его нет) | `lib/telegram.ts`, `app/api/telegram/webhook/[secret]/route.ts` |
| сервер → браузер (бот) | `chatId` не отдаётся ни в одном ответе API | `lib/telegram-link.ts` |
| браузер → сервер (пуши) | `endpoint` подписки — это адрес НАШЕГО исходящего запроса: только https и публичное DNS-имя, никаких IP-литералов и localhost (иначе SSRF по расписанию) | `lib/push-subscription.ts` |
| сервер → push-сервис | тело шифруется ключами самой подписки (RFC 8291): Google/Mozilla передают байты, не читая их; заголовок подписан VAPID | `lib/webpush.ts` |

## Поток данных: типовые сценарии

**Опрос состояния (каждые 2.5 с).** `GET /api/state` → `store.read` (без записи) →
`settle()` в памяти только для отображения → `toPublicView()`. Запись в БД происходит
только на кранке — иначе поллинг создавал бы транзакцию на каждый тик.

**Кранк.** `POST /api/crank` → rate-limit (1/с на игрока) → `store.mutate(identity, now, crank)`.
Внутри мутации: `settle()` (докидываем стек, при простое применяем рейд) → проверка фазы
(`winding` → отказ) → стрик +1 или сброс в 1 → персист под локом/транзакцией.

**Лидерборд.** `GET /api/leaderboard` → `store.snapshot()` (все игроки) →
`buildLeaderboard()`: каждому `settle()` на текущий момент, сортировка по живому стеку,
сумма = «общий сейф», приватность ярлыков. Ранг и число игроков поднимаются в `GameSection`
и оттуда — в игру: от них зависит скин сейфа.

**Вход кошельком.** `GET /api/auth/nonce` (nonce в httpOnly-cookie) → клиент собирает
SIWE-сообщение и подписывает → `POST /api/auth/verify` → идентичность становится
`wallet:0x…`, сервер сам читает баланс $VLTR и ставит `boost`.

**Браузерные напоминания (веб-пуши).** Клиент (`PushReminders.tsx`) спрашивает
`GET /api/push/subscribe` → получает публичный ключ VAPID → по КЛИКУ игрока просит разрешение,
регистрирует `/sw.js` и отдаёт подписку в `POST /api/push/subscribe` (endpoint валидируется,
запись upsert'ится по нему). Рассылка — тот же путь, что у бота: `POST /api/telegram/remind`
читает `snapshot()` + `pushSubscriptions()`, считает `settle()` ТОЛЬКО в памяти, выбирает
события общей функцией `dueKinds` и шлёт зашифрованные пуши. Мёртвые подписки (404/410 или
8 неудач подряд) удаляются на месте. `store.mutate` в этом пути нет — пуш не может начислить стек.

**Привязка Telegram.** `POST /api/telegram/link` выдаёт одноразовый код владельцу
текущей сессии → игрок отправляет боту `/start <код>` → Telegram шлёт апдейт на
`POST /api/telegram/webhook/[secret]` → роут гасит код (`consumeLinkCode`) и связывает
`identity ↔ chatId` (`store.linkTelegram`). Рассылка — отдельный путь: GitHub Actions по
расписанию дёргает `POST /api/telegram/remind`, который читает `snapshot()` +
`telegramLinks()`, считает `settle()` ТОЛЬКО в памяти (как борд) и решает, кому что
написать — ни один из путей не трогает `store.mutate`, бот не может кранкать.

## Карта файлов

```
app/
  page.tsx                лендинг: hero → how → game → board → token → trust → faq
  layout.tsx              шрифты, метаданные, SEO, skip-link
  providers.tsx           wagmi + react-query
  globals.css             вся стилистика (1500 строк, см. design.md)
  Vault.tsx               игровой экран: машина, кранк, ридауты
  Leaderboard.tsx         недельный борд + общий сейф
  components/             лендинг-секции, ConnectButton, SafeSprite, ProfileEditor
  api/                    state · crank · leaderboard · profile · auth/* · boost/refresh · health
                          telegram/link · telegram/unlink · telegram/webhook/[secret] · telegram/remind
                          push/subscribe · push/unsubscribe
  pwa-icon/route.tsx      иконки установленного приложения (192/512) по стабильному пути
  components/PushReminders.tsx   виджет браузерных напоминаний (рядом с TelegramLink)
  error.tsx global-error.tsx not-found.tsx      границы ошибок
  icon.tsx apple-icon.tsx opengraph-image.tsx manifest.ts robots.ts sitemap.ts
lib/
  game.ts                 ЯДРО: тайминги, экономика, фазы, settle, crank  (чистое)
  leaderboard.ts          ранги, общий сейф, недельный цикл, приватность  (чистое)
  skins.ts                скины сейфа по рангу + гейтинг по размеру комьюнити (чистое)
  profile.ts              валидация ников                                (чистое)
  store.ts                интерфейс Store + выбор реализации
  store-file.ts           dev-стор в .data/players.json (локи на identity)
  store-prisma.ts         прод-стор, транзакции + SELECT FOR UPDATE
  session.ts              подписанная cookie-идентичность (HMAC, Web Crypto)
  auth.ts                 общие константы SIWE, walletIdentity/addressFromIdentity
  http.ts                 resolveIdentity() для роутов
  ratelimit.ts            лимиты эндпоинтов: общий стор, фолбэк в память процесса
  kv.ts                   REST-клиент Redis (Vercel KV / Upstash), null если не настроен
  chain.ts vltr.ts wagmi.ts   сеть, чтение баланса, конфиг коннекторов
  links.ts                внешние ссылки (заглушки с «soon») + TELEGRAM_BOT_USERNAME
  telegram.ts             Bot API клиент, секреты вебхука/крона, статус фичи
  telegram-link.ts        одноразовый код привязки (KV, фолбэк в память), completeLink
  telegram-remind.ts      dueReminders (чистая), идемпотентность, прогон рассылки
  telegram-copy.ts        тексты сообщений бота
  reminders.ts            ОБЩЕЕ расписание напоминаний: dueKinds            (чистое)
  webpush.ts              шифрование RFC 8291 + подпись VAPID на node:crypto (без зависимостей)
  push.ts                 конфиг/статус веб-пушей, отправка одному адресату
  push-remind.ts          duePushReminders (чистая), дедуп по устройству, прогон + чистка мёртвых
  push-subscription.ts    валидация подписки, политика endpoint'ов, отпечаток для логов
  push-copy.ts            тексты и пайлоад уведомлений                      (чистое)
proxy.ts                  сессия + CSP с nonce
prisma/schema.prisma      Player, CrankLog, WeekResult, TelegramLink, PushSubscription
public/sw.js              service worker: показ пушей, клик → сайт; НИЧЕГО не кэширует
scripts/                  check-secrets · seed-bots · test-auth · test-profile · render-*
reference/                HTML-прототип механики (эталон петли, не эталон визуала)
```

## Договорённости по коду

- Пути импортов через `@/` (см. `tsconfig.json`).
- Комментарии в коде — на русском, отвечают на «почему», а не «что».
- Все роуты: `runtime = "nodejs"`, `dynamic = "force-dynamic"`. Лендинг тоже
  `force-dynamic` — иначе статический HTML не получит per-request CSP-nonce.
- Next.js здесь **не тот, что в тренировочных данных** (v16, `proxy.ts` вместо
  `middleware.ts`): перед правкой фреймворочных вещей читать `node_modules/next/dist/docs/`.

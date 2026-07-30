# Деплой и конфигурация

Цель — Vercel + Vercel Postgres. Код к деплою готов; нужны аккаунт Егора и реальные
значения сети/токена.

## Переменные окружения

Полный список с комментариями — `.env.example`. Локально копируется в `.env.local`
(заполнять не обязательно: без `DATABASE_URL` включается файловый стор).

### Серверные

| Переменная | Прод | Смысл |
|---|---|---|
| `SESSION_SECRET` | **обязательна** (≥16 симв.) | подпись cookie-сессий. Без неё прод намеренно падает: дефолт публично известен из репозитория → подделка чужих аккаунтов. `openssl rand -base64 32` |
| `DATABASE_URL` | **обязательна** | Postgres. Пусто в проде → падаем (файловая ФС на Vercel эфемерна, стейт терялся бы молча) |
| `AUTH_DOMAIN` | **обязательна** | домен без схемы для проверки SIWE. Без неё `/api/auth/verify` отвечает 500: `Host` присылает сам запрос, и проверка подписи против него не проверяет ничего |
| `BOARD_EXCLUDE` | пусто | адреса кошельков команды через запятую: играют как все, но вырезаются из борда, счётчика игроков и общего сейфа. Выплаты делаются руками по борду, поэтому «нет в борде» = «не получает» |
| `TRUST_PROXY_XFF` | **не выставлять** | только самохостинг за прокси, перезаписывающим `X-Forwarded-For`. На Vercel доверенный IP берётся из `x-vercel-forwarded-for` |
| `ADMIN_SECRET` | **обязательна до первой выплаты** (≥16 симв.) | секрет для `POST /api/admin/close-week` (финализация недели) и `GET /api/admin/security` (сводка отказов). Пусто → close-week отвечает 503. Денег роут не отправляет, только считает список |
| `TELEGRAM_ADMIN_CHAT_ID` | желательна | чат владельца для алертов безопасности (задача 1.5). Пусто — счётчики считаются, но алерт не уходит: всплеск придётся замечать самому. Свой id — у `@userinfobot` |
| `KV_REST_API_URL` | до реальных призов | Redis для rate-limit (и для одноразовых кодов Telegram / дедупа рассылки, см. ниже). Vercel KV подставляет сам при привязке стора |
| `KV_REST_API_TOKEN` | до реальных призов | токен к нему. Альтернатива — пара `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` |
| `TELEGRAM_BOT_TOKEN` | нужна, чтобы включить бота | токен из @BotFather. Формат `\d{8,10}:[A-Za-z0-9_-]{35}` — под этот паттерн настроен `check:secrets` |
| `TELEGRAM_WEBHOOK_SECRET` | нужна, чтобы включить бота (≥32 симв.) | ГЛАВНЫЙ контроль вебхука. В `secret_token` при `setWebhook` уходит САМО значение (Telegram шлёт его заголовком на каждый апдейт), а в сегмент пути — `SHA-256` от него. Значения разные намеренно: URL попадает в логи, в историю терминала и в базу Telegram, и будь там сам секрет, утечка URL отдавала бы и заголовок. `openssl rand -hex 32`. **Ротация:** новое значение в env → передеплой → `npm run telegram:setup` заново (URL меняется вместе с секретом) |
| `CRON_SECRET` | нужна, чтобы включить бота (≥16 симв.) | секрет `POST /api/telegram/remind` (`Authorization: Bearer`). То же значение кладётся в GitHub Secrets репозитория для workflow-рассылки (см. ниже) |
| `GAME_MODE` | **не выставлять** | `demo` → сжатые тайминги 30с/15с |
| `DEV_FORCE_BOOST` | **не выставлять** | `1` → буст включён принудительно (тест пути буста) |

Без `KV_*` сайт работает, но лимиты считаются каждым инстансом отдельно и обходятся
размазыванием запросов. `/api/health` покажет `rateLimit: "memory"`.

### Публичные (`NEXT_PUBLIC_*`)

| Переменная | Дефолт | Смысл |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | OG-картинка, sitemap, robots |
| `NEXT_PUBLIC_RH_CHAIN_ID` | `4663` в `lib/chain.ts` | chainId Robinhood Chain (`0x1237`, сверен по RPC 30.07) |
| `NEXT_PUBLIC_RH_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | публичный RPC, ключа не требует. **Пустая строка** выключает чтение чейна (нужно тестам без сети) |
| `NEXT_PUBLIC_RH_NAME` | `Robinhood Chain` | подпись сети в UI |
| `NEXT_PUBLIC_RH_EXPLORER` | `https://robinhoodchain.blockscout.com` | ссылки на адреса в борде |
| `NEXT_PUBLIC_VLTR_ADDRESS` | реальный адрес в `lib/chain.ts` | переопределение адреса токена (тестовая сеть / anvil). Дефолт держим в коде: адрес публичен, а опечатка в поле панели уехала бы в прод без ревью |
| `NEXT_PUBLIC_VLTR_DECIMALS` | `18` | десятичные |
| `NEXT_PUBLIC_VLTR_BOOST_MIN` | `1` | абсолютный анти-дуст-минимум. Сам множитель задаётся долей в эмиссии (`HOLDER_TIERS`), см. `docs/game-mechanics.md` |
| `NEXT_PUBLIC_WC_PROJECT_ID` | пусто | WalletConnect (опционально) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | `vaultler_bot` (в коде, `lib/links.ts`) | переопределение username бота. Дефолт — публичный факт в git, тем же способом, что и адрес контракта $VLTR (`lib/chain.ts`); задавать здесь нужно только для тестового бота (dev/staging) |

Без сетевых значений сайт полностью играбелен — просто буст не активируется.

⚠️ **`NEXT_PUBLIC_*` вшиваются в бандл на сборке, а не читаются в рантайме.** Добавить их
после первого деплоя недостаточно — нужен **редеплой**, иначе в sitemap, robots и
OG-картинке останется `http://localhost:3000`. Серверные (`SESSION_SECRET`, `DATABASE_URL`,
`AUTH_DOMAIN`, `KV_*`) читаются в рантайме и подхватываются без пересборки.

## Что уже развёрнуто (2026-07-25)

| | |
|---|---|
| Проект Vercel | `nonbrainkid/thevaultler` (Hobby), автодеплой из `main` |
| Основной домен | **https://thevaultler.fun** (DNS ведёт Vercel, сертификат выпущен) |
| Старый адрес | `thevaultler.vercel.app` → 307 на основной домен |
| Заданы | `SESSION_SECRET` (sensitive), `AUTH_DOMAIN=thevaultler.fun`, `NEXT_PUBLIC_SITE_URL=https://thevaultler.fun` |

**Состояние на 2026-07-28** (проверено запросом `GET /api/health`, а не по памяти):

```jsonc
{"ok":true,"checks":{"store":"postgres","sessionSecret":"set","chain":"configured",
                     "authDomain":"pinned","rateLimit":"shared","clientIp":"trusted"}}
```

То есть Postgres, KV и конфиг сети **уже подключены** — раньше здесь было написано
обратное, и это расхождение само по себе опасно: по документу выходило, что лимиты
обходятся и буст выключен, хотя всё стоит. Осталось незаданным: `ADMIN_SECRET`
(финализация недели) и `NEXT_PUBLIC_RH_EXPLORER` (ссылки на адреса в борде).

Редирект со старого адреса не косметика: `AUTH_DOMAIN` пинит **один** хост, и вход
кошельком на любом другом хосте отвечал бы ошибкой проверки подписи.

### ⚠️ В проекте две базы Neon, рабочая — только одна

| Store | Что это |
|---|---|
| **`vaultler-db`** | **боевая.** `Player`, `CrankLog`, `WeekResult`, `TelegramLink`. Её строка подключения и есть `DATABASE_URL` |
| `vaultler-TG` | **пустая и не используется.** Заведена 28.07 по недоразумению — Telegram-боту отдельная база не нужна, `TelegramLink` живёт рядом с `Player` (одна транзакция, инвариант 2) |

Её переменные приехали с префиксом `telegram_` (`telegram_DATABASE_URL`, `telegram_PGHOST`
и ещё семь), поэтому настоящий `DATABASE_URL` не перезаписан и прод не пострадал.
Владелец решил базу не удалять (2026-07-28).

**Опасность, из-за которой это записано здесь:** девять переменных с префиксом `telegram_`
выглядят рабочими. Достаточно кому-нибудь «навести порядок» и переименовать
`telegram_DATABASE_URL` в `DATABASE_URL` — и прод молча переключится на пустую базу:
борд обнулится, история недель исчезнет, выплаты будет не по чему считать. Ошибка при этом
не выглядит как ошибка, сайт просто покажет ноль игроков.

**Правило:** переменные с префиксом `telegram_` не трогать и ни во что не переименовывать.
Приложение не читает из них ничего.

## Миграция `WeekResult` — ✅ выполнена 2026-07-28

Таблица создана в прод-базе (Neon, консоль Vercel), `/api/health` → `weekResults: "ready"`,
`ok: true`. Индексы на месте: `WeekResult_pkey`, `WeekResult_weekId_identity_key`
(уникальный — без него не работает upsert по `(weekId, identity)`) и
`WeekResult_weekId_rank_idx`.

Ниже — как это повторить на другой базе (preview-окружение, восстановление). Обращение к
таблице случается **впервые в субботу в полночь**, внутри транзакции кранка: без миграции
упадёт не запись результата, а сам кранк — игра встанет в день выплаты.

**Способ 1 — Prisma (предпочтительно).** Вписать прод-строку подключения в `.env.local`
(файл в `.gitignore`, наружу не уходит) и выполнить:

```bash
npx prisma db push
```

**Способ 2 — SQL руками** в консоли Neon (Vercel → Storage → vaultler-db → Query,
предварительно сняв Read-only). Таблица новая и аддитивная, существующие данные не
затрагиваются:

```sql
CREATE TABLE IF NOT EXISTS "WeekResult" (
  "id"        TEXT NOT NULL,
  "weekId"    INTEGER NOT NULL,
  "identity"  TEXT NOT NULL,
  "address"   TEXT,
  "gain"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "rank"      INTEGER,
  "eligible"  BOOLEAN NOT NULL DEFAULT false,
  "share"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "payoutTx"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WeekResult_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WeekResult_weekId_identity_key"
  ON "WeekResult"("weekId", "identity");
CREATE INDEX IF NOT EXISTS "WeekResult_weekId_rank_idx"
  ON "WeekResult"("weekId", "rank");
```

После этого — добавить `ADMIN_SECRET` в env проекта и прогнать репетицию:

```bash
ADMIN_SECRET=... VAULTLER_URL=https://thevaultler.fun npm run close:week -- --dry
```

## Telegram-бот напоминаний (спринт 1.1)

Модель безопасности и карта кода — `docs/security.md` (таблица угроз) и
`docs/api.md` (`/api/telegram/*`). Здесь — только порядок запуска.

**Схема хранения identity ↔ chatId** — новая модель `TelegramLink` в
`prisma/schema.prisma` (`identity` и `chatId` оба `@unique`). Миграция **подготовлена, но
не применена** — прод-`prisma db push` делает владелец, как и раньше (см. предупреждение
выше про порядок «миграция → код»). Локальный файловый стор работает без БД
(`.data/telegram-links.json`, в `.gitignore`).

**Почему рассылка НЕ на Vercel Cron.** Проект на плане **Hobby**: там крон-задания
Vercel ограничены **разом в сутки**, с точностью ±59 минут — окно «2 часа до рейдера»
на суточном тике не попадёт в цель вообще. Хуже: более частое расписание в `crons`
`vercel.json` на Hobby **не просто не работает, а роняет весь деплой** с ошибкой
`Hobby accounts are limited to daily cron jobs`. Поэтому планировщик —
**GitHub Actions** (`.github/workflows/reminders.yml`, cron `*/10 * * * *`), который
делает один `curl -X POST` на `POST /api/telegram/remind` с секретом из GitHub Secrets.
Переезд на нативный Vercel Cron возможен **только после апгрейда проекта на Pro** — тогда
`vercel.json` с `crons` можно завести снова.

GitHub Actions тоже не гарантирует точный тик (под нагрузкой сдвиг 10–20 минут — обычное
дело), поэтому роут выбирает всех, у кого нужное событие уже наступило, а не полагается на
момент вызова — и именно поэтому идемпотентность рассылки по
`(identity, lastCrankAt, kind)` не опция, а обязательное условие (`lib/telegram-remind.ts`).

**Порядок запуска:**

1. Создать бота в `@BotFather` (аккаунт владельца — не автоматизируется) → получить
   `TELEGRAM_BOT_TOKEN`. Записать реальный `username` бота: если он отличается от
   `vaultler_bot`, захардкоженного в `lib/links.ts` как дефолт, переопределить через
   `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (или обновить дефолт в коде, если это постоянное
   имя, — тем же способом, что и адрес контракта $VLTR).
2. Сгенерировать `TELEGRAM_WEBHOOK_SECRET` (`openssl rand -hex 32`) и `CRON_SECRET`
   (`openssl rand -base64 32`).
3. Выставить все три переменные в env Vercel (+ `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, если
   username отличается от дефолта) и передеплоить.
4. Прод-`DATABASE_URL` в окружении → `npx prisma db push` (создаёт таблицу
   `TelegramLink`, аддитивно).
5. Зарегистрировать вебхук: `TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=… npm run
   telegram:setup -- https://thevaultler.fun` (обёртка над `setWebhook`, `lib/telegram.ts`).
6. Добавить `CRON_SECRET` в GitHub Secrets репозитория (Settings → Secrets and
   variables → Actions) — то же значение, что и в env Vercel. Workflow
   `.github/workflows/reminders.yml` подхватит его автоматически на следующем тике
   (можно проверить вручную из вкладки Actions → Run workflow).
7. Проверка: `/api/health` → `telegram: "on"`; `curl -X POST
   https://thevaultler.fun/api/telegram/remind -H "authorization: Bearer $CRON_SECRET"`
   отвечает `200 {"ok":true,...}`.

## Runbook: Vercel

1. **Проект.** Vercel → Add New → Project → импортировать репозиторий. Framework
   определится как Next.js, build/output по умолчанию (`npm run build` уже включает
   `prisma generate` — сгенерированный клиент в `.gitignore`).
2. **База.** Vercel → Storage → Create → **Postgres** → привязать к проекту.
   `DATABASE_URL` подставится автоматически, стор сам переключится на Prisma.
3. **Redis для rate-limit.** Storage → Create → **KV** → привязать к проекту.
   `KV_REST_API_URL` и `KV_REST_API_TOKEN` подставятся сами. Можно отложить: без них
   сайт работает, но лимиты обходятся (см. чеклист).
4. **Env.** Project → Settings → Environment Variables — по таблицам выше.
   Минимум: `SESSION_SECRET`, `AUTH_DOMAIN`, `NEXT_PUBLIC_SITE_URL`.
5. **Схема БД.** Один раз, с прод `DATABASE_URL` в окружении:
   ```bash
   npx prisma db push
   ```
6. **Деплой.** Push в `main` или Deploy в UI.
7. **Проверка.**
   ```bash
   curl https://<домен>/api/health
   ```
   Ожидаем `{"ok":true, checks:{store:"postgres", sessionSecret:"set", …}}`.
   `chain:"placeholder"` и `rateLimit:"memory"` на старте — норма, см. чеклист.

## Чеклист перед публичным запуском

Порядок важен: первые пять — чтобы сайт вообще поднялся, остальные — чтобы можно было
раздавать реальные призы.

**Чтобы запустить сайт:**

- [ ] `SESSION_SECRET` — стойкий, не из репозитория.
- [ ] `DATABASE_URL` — привязан Vercel Postgres.
- [ ] `npx prisma db push` выполнен с прод-строкой подключения.
- [ ] `AUTH_DOMAIN` совпадает с реальным доменом (без него вход кошельком отвечает 500).
- [ ] `GAME_MODE` и `DEV_FORCE_BOOST` **не** выставлены.
      (`DEV_FORCE_BOOST` в проде игнорируется кодом, но в env ему всё равно не место.)
- [ ] `/api/health` отвечает `store:"postgres"`, `sessionSecret:"set"`, `authDomain:"pinned"`.

**Чтобы раздавать реальные призы:**

- [ ] `KV_REST_API_URL` + `KV_REST_API_TOKEN` заданы, `/api/health` → `rateLimit:"shared"`.
      Без этого лимиты обходятся размазыванием запросов по инстансам.
- [ ] `/api/health` → `clientIp:"trusted"`. `"session"` означает, что перед приложением
      нет прокси с доверенным IP, и лимиты держатся на легко сбрасываемой cookie.
- [ ] `node scripts/seed-bots.mjs --clear` — убрать тестовых ботов.
- [ ] Реальный конфиг сети (`NEXT_PUBLIC_RH_RPC_URL`, chainId, explorer) подставлен — адрес токена уже в коде, но без RPC `VLTR_CONFIGURED` остаётся false и буст не включается.
- [ ] `npx prisma db push` после смены схемы `boost` → `boostTier`/`boostPpb`.
- [x] **Таблица `WeekResult` создана в проде** (2026-07-28), `/api/health` → `"ready"`.
- [x] **`ADMIN_SECRET` задан** (2026-07-28, вписал владелец — секреты не проходят через
      чат и логи). Проверка без токена: роут отвечает `401 unauthorized`, а не
      `503 admin_secret_missing`, то есть переменная дошла до рантайма.
- [ ] Репетиция: `npm run close:week -- --dry` отвечает 200 и показывает ожидаемый список.
      Прогнать **до** субботы, а не в субботу.
- [ ] Баланс прода (`BASE_RATE_PER_SEC`, пороги тиров) откалиброван — сейчас плейсхолдеры.
- [ ] Политика выплат пула зафиксирована (реальные токены, вручную — решение за Егором).
- [ ] `npm run check:secrets` пройден (запускается и автоматически в pre-push).

**Чтобы включить Telegram-напоминания (спринт 1.1):**

- [ ] Бот создан в `@BotFather`, `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` /
      `CRON_SECRET` заданы в env Vercel.
- [ ] `npx prisma db push` выполнен ПОСЛЕ добавления `TelegramLink` в схему (аддитивно).
- [ ] `npm run telegram:setup -- https://thevaultler.fun` отработал успешно (`setWebhook`).
- [ ] `CRON_SECRET` добавлен в GitHub Secrets репозитория, workflow
      `.github/workflows/reminders.yml` включён (виден во вкладке Actions).
- [ ] `/api/health` → `telegram: "on"`.
- [ ] `node scripts/test-telegram.mjs` пройден против прод-подобного стенда (см.
      docs/testing.md) — не запускать против настоящего прод-бота с реальными игроками.

## Локальный запуск

```bash
npm install
cp .env.example .env.local        # заполнять не обязательно
npm run dev                       # http://localhost:3000
GAME_MODE=demo npm run dev        # быстрый цикл петли 30с/15с
git config core.hooksPath .githooks   # один раз: pre-push аудит секретов
```

Полезное: `npm run db:push`, `npm run db:studio` (только при заданном `DATABASE_URL`).

## Сборка: что нужно знать

- `postinstall` и `build` вызывают `prisma generate` — клиент генерируется в
  `lib/generated/prisma` и **не коммитится**.
- `serverExternalPackages: ["@prisma/client", ".prisma/client"]` в `next.config.ts` —
  чтобы Next не тащил нативный движок Prisma в бандл serverless-функции.
- Импорт `FileStore` обёрнут в `NODE_ENV !== "production"` (`lib/store.ts`). Условие
  статически вычислимо, поэтому в прод-сборке ветка вырезается вместе с `fs`/`path`.
- **Build-варнинг Turbopack «whole project traced» остаётся.** Источник — не файловый
  стор (как считалось раньше), а сгенерированный клиент Prisma. Import trace:

  ```
  ./lib/generated/prisma/index.js → ./lib/store-prisma.ts → ./lib/store.ts → ./app/api/*/route.ts
  ```

  Клиент делает fs-операции, чтобы найти бинарь движка. `serverExternalPackages` его
  не спасает: опция принимает **имена пакетов**, а `output` в `prisma/schema.prisma`
  указывает на `lib/generated/prisma` — путь внутри проекта, не пакет в `node_modules`.
  Next считает его обычным исходником, идёт по динамическим `require` и трассирует всё.

  Последствие — раздутый бандл serverless-функции (медленнее холодный старт), не ошибка;
  сборка и рантайм работают. Правильное лечение — вернуть генератор в `node_modules`,
  чтобы сработало уже прописанное `serverExternalPackages: ["@prisma/client"]`. Трогает
  слой данных, поэтому делать **после** запуска, а не перед.
- `npm audit` показывает уязвимости в транзитивных `postcss`/`sharp` из Next 16;
  автофикс откатывает Next до 9.x (неприемлемо). Наш код не затронут.

## Осталось на Егора (вне кода)

- деплой на Vercel: его аккаунт + Postgres + env;
- реальный конфиг Robinhood Chain и адрес $VLTR;
- политика выплат пула и её исполнение (реальные токены — не автоматизируем);
- GitHub-организация и перенос репозитория (создать орг может только владелец аккаунта);
- юридическая проверка формулировки «приз за место в игре» (см. `docs/leaderboard-rewards.md`).

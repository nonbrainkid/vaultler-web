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
| `AUTH_DOMAIN` | задать явно | домен без схемы для проверки SIWE. `Host` можно подделать, поэтому в проде пинится |
| `KV_REST_API_URL` | до реальных призов | Redis для rate-limit. Vercel KV подставляет сам при привязке стора |
| `KV_REST_API_TOKEN` | до реальных призов | токен к нему. Альтернатива — пара `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` |
| `GAME_MODE` | **не выставлять** | `demo` → сжатые тайминги 30с/15с |
| `DEV_FORCE_BOOST` | **не выставлять** | `1` → буст включён принудительно (тест пути буста) |

Без `KV_*` сайт работает, но лимиты считаются каждым инстансом отдельно и обходятся
размазыванием запросов. `/api/health` покажет `rateLimit: "memory"`.

### Публичные (`NEXT_PUBLIC_*`)

| Переменная | Дефолт | Смысл |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | OG-картинка, sitemap, robots |
| `NEXT_PUBLIC_RH_CHAIN_ID` | `88991` (PLACEHOLDER) | chainId Robinhood Chain |
| `NEXT_PUBLIC_RH_RPC_URL` | пусто | пусто → чтение баланса выключено |
| `NEXT_PUBLIC_RH_NAME` | `Robinhood Chain` | подпись сети в UI |
| `NEXT_PUBLIC_RH_EXPLORER` | пусто | ссылки на адреса в борде |
| `NEXT_PUBLIC_VLTR_ADDRESS` | пусто | адрес токена |
| `NEXT_PUBLIC_VLTR_DECIMALS` | `18` | десятичные |
| `NEXT_PUBLIC_VLTR_BOOST_MIN` | `1` | минимум на балансе для буста ×5 |
| `NEXT_PUBLIC_WC_PROJECT_ID` | пусто | WalletConnect (опционально) |

Без сетевых значений сайт полностью играбелен — просто буст не активируется.

⚠️ **`NEXT_PUBLIC_*` вшиваются в бандл на сборке, а не читаются в рантайме.** Добавить их
после первого деплоя недостаточно — нужен **редеплой**, иначе в sitemap, robots и
OG-картинке останется `http://localhost:3000`. Серверные (`SESSION_SECRET`, `DATABASE_URL`,
`AUTH_DOMAIN`, `KV_*`) читаются в рантайме и подхватываются без пересборки.

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
- [ ] `AUTH_DOMAIN` совпадает с реальным доменом (иначе вход кошельком отвалится).
- [ ] `GAME_MODE` и `DEV_FORCE_BOOST` **не** выставлены.
- [ ] `/api/health` отвечает `store:"postgres"`, `sessionSecret:"set"`.

**Чтобы раздавать реальные призы:**

- [ ] `KV_REST_API_URL` + `KV_REST_API_TOKEN` заданы, `/api/health` → `rateLimit:"shared"`.
      Без этого лимиты обходятся размазыванием запросов по инстансам.
- [ ] `node scripts/seed-bots.mjs --clear` — убрать тестовых ботов.
- [ ] Реальный конфиг сети и адрес $VLTR подставлены (иначе буст ×5 просто не включается).
- [ ] Баланс прода (`BASE_RATE_PER_SEC`, пороги тиров) откалиброван — сейчас плейсхолдеры.
- [ ] Политика выплат пула зафиксирована (реальные токены, вручную — решение за Егором).
- [ ] `npm run check:secrets` пройден (запускается и автоматически в pre-push).

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

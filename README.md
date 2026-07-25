# THE VAULTLER

Мем-токен **$VLTR** + ежедневный минигейм на Robinhood Chain (Arbitrum Orbit L2).
Заводишь машину (CRANK) — она стакает `$STACK`, пока ты спишь. Вернулся в окно —
стрик и множитель растут (компаунд). Проспал — приходит рейдер и скимит стек.
Топ-10 недельного борда делит пул из торговых фисов. Вайб: анти-трейдинг, про-стакинг.
Визуал — пиксель-вестерн.

> **Не финансовый совет. Кастодии средств нет.** Кошелёк используется только для
> подписи входа и чтения публичного баланса — ни транзакций, ни approve, ни депозитов.

## Главный принцип: сервер — источник правды

Стек, стрики и тайминги считаются и хранятся **на сервере** (`lib/game.ts` + API),
клиент только рисует. Борд делит реальные токены — если бы состояние жило в браузере,
любой накрутил бы себе топ через DevTools.

## Стек

Next.js 16 (App Router) · React 19 · TypeScript · Prisma (Postgres) · wagmi + viem ·
plain CSS (пиксель-арт) · vitest. Деплой — Vercel.

## Запуск локально

```bash
npm install
cp .env.example .env.local          # заполнять не обязательно для локали
npm run dev                         # http://localhost:3000
GAME_MODE=demo npm run dev          # быстрый цикл петли: 30с/15с вместо 24ч/12ч
git config core.hooksPath .githooks # один раз: pre-push аудит секретов
```

Без `DATABASE_URL` используется файловый стор `.data/players.json` — БД для разработки
не нужна.

```bash
npm test               # юнит-тесты чистой логики
npm run test:auth      # e2e-проверка входа кошельком (нужен запущенный dev-сервер)
npm run check:secrets  # аудит секретов: рабочее дерево + вся история git
```

## Безопасность репозитория

Репозиторий **приватный**. Перед каждым пушем прогоняется `npm run check:secrets` —
он проверяет и рабочее дерево, и всю историю коммитов (при пуше уезжают все коммиты,
и секрет, удалённый следующим коммитом, всё равно остаётся в git). Аудит подключается
git-хуком (`git config core.hooksPath .githooks`) и блокирует пуш при провале.

Секреты живут в `.env.local` и в env-переменных Vercel. В `.env.example` — только пустые
плейсхолдеры. `SESSION_SECRET` в проде обязателен: без него приложение намеренно падает.

## Документация

| Файл | О чём |
|---|---|
| [CLAUDE.md](CLAUDE.md) | карта проекта, инварианты, указатель по всем docs |
| [docs/architecture.md](docs/architecture.md) | слои, потоки данных, карта файлов |
| [docs/game-mechanics.md](docs/game-mechanics.md) | петля, фазы, формулы, тиры |
| [docs/api.md](docs/api.md) | эндпоинты и форматы ответов |
| [docs/data-store.md](docs/data-store.md) | сторы, атомарность, схема БД |
| [docs/auth-session.md](docs/auth-session.md) | сессия, SIWE-вход, ники, rate-limit |
| [docs/security.md](docs/security.md) | модель угроз, CSP, аудит секретов |
| [docs/design.md](docs/design.md) | палитра, CSS, спрайт сейфа, скины, адаптив |
| [docs/frontend.md](docs/frontend.md) | компоненты, состояние, копирайтинг-гардрейлы |
| [docs/web3.md](docs/web3.md) | сеть, токен, кошелёк, буст |
| [docs/leaderboard-rewards.md](docs/leaderboard-rewards.md) | борд, пул, экономика наград |
| [docs/testing.md](docs/testing.md) | тесты, e2e-скрипты, сидер ботов |
| [docs/deployment.md](docs/deployment.md) | env, runbook Vercel, чеклист запуска |
| [NOTES.md](NOTES.md) | журнал решений и открытые вопросы |

## Деплой

Пошаговый runbook (Vercel + Postgres + env + чеклист перед публичным запуском) —
[docs/deployment.md](docs/deployment.md).

## Майлстоуны

**M1** ядро петли и API · **M2** вход кошельком (SIWE) + буст за холд ·
**M3** недельный борд и общий сейф · **M4** *(в работе)* полировка и анти-чит ·
**M5** лендинг и бренд.

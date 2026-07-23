# THE VAULTLER

Мем-токен + ежедневный минигейм на Robinhood Chain (Arbitrum Orbit L2).
Заводишь машину (CRANK) — она стакает $STACK, пока ты спишь. Вернулся в окно —
стрик и множитель растут (компаунд). Проспал — приходит рейдер и скимит стек.
Вайб: анти-трейдинг, про-стакинг. Пиксель-вестерн.

> **Не финансовый совет. Никакой кастодии средств. Только wallet-connect (чтение баланса + подпись для входа).**

## Главный принцип: сервер — источник правды
Стек, стрики и тайминги кранка считаются и хранятся **на сервере** (`lib/game.ts` + API).
Клиент только рисует. Лидерборд раздаёт реальные токены — если бы состояние жило в браузере,
любой накрутил бы себе топ. Подробности и решения — в [NOTES.md](NOTES.md).

## Стек
Next.js 16 (App Router) · TypeScript · Prisma (Postgres) · wagmi + viem · plain CSS (пиксель-арт).

## Запуск локально
```bash
npm install
cp .env.example .env.local          # заполнять не обязательно для локали
npm run dev                         # http://localhost:3000
# быстрый демо-цикл петли (30с/15с вместо 24ч/12ч):
GAME_MODE=demo npm run dev
```
Без `DATABASE_URL` используется файловый стор (`.data/players.json`) — БД не нужна для разработки.

## Тесты
```bash
npm test          # юнит-тесты ядра механики (lib/game.ts)
```

## Деплой на Vercel
1. Создать проект на Vercel, подключить репозиторий.
2. Storage → создать **Vercel Postgres**, он проставит `DATABASE_URL`.
3. Выставить env (см. `.env.example`): обязательно `SESSION_SECRET`, а также реальные
   `NEXT_PUBLIC_RH_*` и `NEXT_PUBLIC_VLTR_*` для сети/токена.
4. Применить схему БД: `npx prisma db push` (или `prisma migrate deploy`) с прод `DATABASE_URL`.
5. `npm run build` уже включает `prisma generate`. Деплой.

## Майлстоуны
- **M1** — server-authoritative ядро петли (crank/wind/streak/raider/tiers), БД, API.
- **M2** — wallet-connect (SIWE-вход) + серверный буст ×1.5 за холд $VLTR.
- **M3** — недельный лидерборд + коллективный «общий сейф».
- **M4** — полировка, анти-чит, подготовка к деплою.

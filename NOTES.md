# VAULTLER — рабочие заметки

Живой журнал решений и открытых вопросов. Обновляется по ходу майлстоунов.

## Стек
- Next.js 16 (App Router) + TypeScript, plain CSS (без Tailwind — нужен точный контроль над пиксель-артом).
- БД: **Vercel Postgres** (решено 2026-07-23). Prisma как ORM.
- Кошелёк (M2): wagmi + viem + connectkit. Сеть — Robinhood Chain (Arbitrum Orbit L2).
- Деплой: Vercel. Репо: git, ветка `main`.

## Решения (2026-07-23)
- **Дизайн:** пиксель-вестерн, как на странице X @VaultlerRH (не латунный прототип). Механика прототипа — эталон, визуал перерисовываем в пиксель-стиле.
- **БД на M1:** Vercel Postgres сразу (Prisma `provider = postgresql`).
- **Grace-окно (прод):** 24ч завод + 12ч grace на перекранк.
- **Идентичность на M1:** временная серверная сессия (подписанная cookie с dev-id).
  В M2 заменяется на авторизацию подписью кошелька (SIWE-стиль). «Один аккаунт = один кошелёк» доводим в M2.

## Критическое правило: сервер — источник правды
Стек/стрик/тайминги считаются и хранятся на сервере. Клиент только рисует.
Причина: лидерборд раздаёт реальные токены. В прототипе стейт жил в `window.storage` —
любой мог выставить `S.total = 999999` через DevTools и украсть призовой пул.
Вся математика петли — в `lib/game.ts` (чистые функции) + API-роуты, время серверное.

## Механика (из reference/vaultler-minigame.html)
- CRANK → завод на WIND, машина стакает по ставке. Во время завода кранк запрещён.
- После завода окно GRACE: успел крутануть → streak+1; проспал WIND+GRACE → рейд (skim %), streak→0.
- `mult = (1 + streak*0.2) * (boost ? 1.5 : 1)`; `rate = BASE * mult`.
- Тиры по стеку: Tin Can(0) → Safe(500) → Vault(2500) → Fort(10k) → Gold Reserve(50k).
- Буст ×1.5 за холд $VLTR (M2, читается on-chain).

### Демо-режим
`GAME_MODE=demo` в env → сжатые тайминги (WIND 30с / GRACE 15с / BASE 5) как в прототипе,
чтобы тестировать петлю быстро. В проде переменная не выставляется → 24ч/12ч.

## Идентичность / сессия (реализовано)
- Сессия ставится в `proxy.ts` (Next 16 middleware→proxy) на НАВИГАЦИОННОМ ответе,
  а не через fetch. Причина: некоторые браузеры (и наш preview-sandbox) не сохраняют
  Set-Cookie из fetch-ответов; навигационные куки сохраняются везде. Заодно чинит гонку
  двойного минта идентичности при dev-StrictMode.
- Идентичность прокидывается в роут заголовком `x-vaultler-id` (proxy → route), cookie
  подписана HMAC-SHA256 (Web Crypto, edge+node). Клиент не подделает чужой id.

## Открытые вопросы
- [ ] **Баланс прода:** BASE_RATE_PER_SEC и пороги тиров под 24ч-петлю нужно калибровать
      (сейчас placeholder). Определиться, сколько стека даёт «идеальная неделя».
- [ ] Robinhood Chain: RPC URL, chainId, адрес контракта $VLTR — уточнить у Егора (для M2).
- [ ] Vercel Postgres: подключить проект к Vercel и получить `DATABASE_URL` (для локали и прода).
- [ ] Анти-мультиаккаунт: политика при смене кошелька, привязка device/IP (M4).

## Известные issues
- `npm audit` показывает 3 уязвимости (postcss/sharp) — транзитивные из Next 16.
  «Фикс» откатывает Next до 9.x (неприемлемо). Ждём патч апстрима; наш код не затронут.
- Build-варнинг Turbopack про «whole project traced» — от `FileStore` (fs/path).
  Это dev-бэкенд; в проде используется Prisma. Не блокирует. На M4 можно закрыть импорт
  файлового стора условием `NODE_ENV !== production`.
- Скриншот-растр не снимается в текущем preview-sandbox (read_page/JS работают, capture — нет).
  UI проверялся через DOM-дерево и computed styles. Открой http://localhost:3005 (`npm run dev`).

## Для деплоя (M4, не забыть)
- Vercel Postgres: создать БД, прокинуть `DATABASE_URL` → стор сам переключится на Prisma.
- В build добавить `prisma generate` (клиент gitignore-нут): `"build": "prisma generate && next build"`.
- Выставить стойкий `SESSION_SECRET` в env.
- Rate-limit перевести на общий стор (сейчас память процесса).

## M2 — кошелёк и буст (реализовано)
- wagmi + viem (connectkit несовместим с React 19 → своя кнопка коннекта в теме).
- Коннектор: injected (MetaMask/in-app). WalletConnect/Coinbase добавим при projectId.
- Вход: SIWE-стиль. `GET /api/auth/nonce` → подпись сообщения кошельком →
  `POST /api/auth/verify` (viem verifyMessage) → идентичность = `wallet:<addr>` (один кошелёк = один аккаунт).
- Буст ×1.5: сервер читает баланс $VLTR on-chain (`lib/vltr.ts`) и сам ставит `boost`.
  Клиент буст НЕ задаёт (иначе накрутил бы холд). `DEV_FORCE_BOOST=1` — тест пути буста.
- Проверено: SIWE end-to-end (valid→200 wallet-identity, битая подпись→401), буст→mult 1.5.

### Env для M2 (в проде выставить реальные)
- `NEXT_PUBLIC_RH_CHAIN_ID`, `NEXT_PUBLIC_RH_RPC_URL`, `NEXT_PUBLIC_RH_NAME`, `NEXT_PUBLIC_RH_EXPLORER`
- `NEXT_PUBLIC_VLTR_ADDRESS`, `NEXT_PUBLIC_VLTR_DECIMALS`, `NEXT_PUBLIC_VLTR_BOOST_MIN`
- `NEXT_PUBLIC_WC_PROJECT_ID` (опц., для WalletConnect), `DEV_FORCE_BOOST` (только dev)

## Лог майлстоунов
- **M1 (готово):** server-authoritative ядро петли, сторы, сессия через proxy, API, пиксель-UI.
- **M2 (готово):** wallet-connect (wagmi), SIWE-вход, серверный буст ×1.5 за $VLTR.
- **M3 (в работе):** недельный лидерборд + коллективный «общий сейф».

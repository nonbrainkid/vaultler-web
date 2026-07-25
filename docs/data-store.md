# Хранилище данных

`lib/store.ts` (интерфейс) · `lib/store-file.ts` (dev) · `lib/store-prisma.ts` (прод) ·
`prisma/schema.prisma` (схема).

## Выбор реализации

```
DATABASE_URL задан        → PrismaStore (Postgres)
DATABASE_URL пуст, dev    → FileStore (.data/players.json)
DATABASE_URL пуст, prod   → падаем с внятной ошибкой
```

Последнее — намеренно: на Vercel файловая система эфемерна, файловый стор молча терял бы
стейт игроков (и их место в борде, который делит реальные токены). Лучше явный отказ
при старте, чем тихая потеря данных. Реализация кэшируется в модульном синглтоне.

## Интерфейс `Store`

| Метод | Назначение | Атомарность |
|---|---|---|
| `read(identity, now)` | прочитать стейт (или `initialState`) **без записи** | не нужна |
| `mutate(identity, now, fn)` | read-modify-write чистой функцией из `lib/game` | лок / транзакция |
| `snapshot()` | все игроки со стейтами — для борда | нет |
| `setProfile(identity, now, patch)` | ник + приватность, с проверкой уникальности | глобальная сериализация |

## Почему `mutate` — атомарный

Без лока два одновременных кранка читают один стейт и оба начисляют стек — классическая
гонка, из которой делается накрутка (открыть две вкладки и жать одновременно).

- **FileStore**: цепочка промисов на каждую `identity` (`withLock`) — операции одного
  игрока строго последовательны. Запись в файл тоже сериализована (`writeChain`).
- **PrismaStore**: `prisma.$transaction` + `SELECT 1 … FOR UPDATE` на строку игрока,
  затем `upsert`. Строка лочится на время транзакции.

`GET /api/state` намеренно **не** использует `mutate`: поллинг раз в 2.5 с создавал бы
транзакцию на каждый тик, а стек и так детерминирован из таймстемпов. Персист — на кранке.

## Уникальность ников

Ник уникален глобально **без учёта регистра**: хранится `nickname` (как показывать)
и `nicknameKey` (lowercase, `@unique`).

Гонка «два игрока разом занимают один ник» закрыта на обоих сторах:
- **Prisma**: `findFirst` по `nicknameKey` — быстрый путь; если оба прошли проверку,
  unique-констрейнт отвергает второго, ошибка `P2002` перехватывается и превращается
  в чистый `409 nickname_taken` вместо 500;
- **FileStore**: `profileChain` — глобальная сериализация **всех** `setProfile`
  (per-identity лока тут недостаточно: проверка «ник свободен» должна видеть всех разом).

Покрыто `lib/profile.test.ts` и e2e `scripts/test-profile.mjs` (в нём есть отдельный
кейс на гонку).

## Схема БД

```prisma
model Player {
  id           String   @id @default(cuid())
  identity     String   @unique   // "wallet:0x…" | "dev:uuid" | "bot:name"
  stack        Float    @default(0)
  streak       Int      @default(0)
  lastCrankAt  BigInt?            // epoch ms
  lastSettleAt BigInt             // epoch ms
  machineOn    Boolean  @default(false)
  boost        Boolean  @default(false)
  nickname     String?
  nicknameKey  String?  @unique   // lowercase — ключ уникальности
  hideWallet   Boolean  @default(false)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  crankLogs    CrankLog[]
  @@index([stack])                // сортировка борда
}

model CrankLog {                  // аудит кранков: анти-чит и разбор споров
  id String @id @default(cuid())
  playerId String
  at BigInt          // серверный epoch ms
  ok Boolean         // прошёл ли валидацию фазы
  phase String       // фаза на момент попытки (до завода)
  streak Int
  stack Float        // стек ПОСЛЕ кранка — точка отсчёта при разборе
  lostToRaid Float?  // ским рейдера в этом же settle; null — рейда не было
  @@index([playerId, at])
}
```

`BigInt` для времени: epoch ms не влезает в `Int`. Конвертация в/из `number` — в
`toState`/`toWrite` (`store-prisma.ts`).

### Журнал кранков

Пишется в **той же транзакции**, что и стейт игрока: иначе падение между двумя записями
развело бы журнал с тем, что он описывает, и он перестал бы быть доказательством.
Механика — необязательный четвёртый аргумент `mutate`:

```ts
store.mutate(identity, now, fn, (outcome) => CrankAudit | null)
```

`null` — не писать. Роут `/api/crank` журналирует **только успешные** кранки: отклонённые
(фаза `winding`) стейт не меняют, спорить о них не о чем, а клиент, поллящий кранк, при
лимите 1/сек нагенерил бы до 86 400 строк в сутки на игрока.

Файловый стор аргумент принимает и игнорирует — он только для локальной разработки,
где реальных призов и споров не бывает.

## Форматы идентичности

| Префикс | Откуда | Ник разрешён | Адрес на борде |
|---|---|---|---|
| `dev:uuid` | анонимная cookie-сессия из `proxy.ts` | нет (403) | нет, ярлык «anon» |
| `wallet:0x…` | подтверждённая SIWE-подпись | да | да, если не скрыт |
| `bot:name` | `scripts/seed-bots.mjs` (только dev) | — | нет, тег `test` на борде |

Сырая идентичность наружу не отдаётся никогда — только производный ярлык
(`displayFor` в `lib/leaderboard.ts`).

## Локальные данные

`.data/players.json` — dev-персист, **в `.gitignore`** и в списке запретных файлов
аудита секретов. Файловый стор кэширует данные в памяти: после ручной правки файла
или сидинга ботов dev-сервер надо перезапустить.

## Известные ограничения

- `snapshot()` тянет **всех** игроков и считает `settle` каждому в памяти. На тысячах
  игроков нужна пагинация или материализованный топ (запись `stack` при кранке + `ORDER BY`).
- Прогон миграций: сейчас `prisma db push` (см. `docs/deployment.md`), полноценных
  миграций нет — до первого прода это дешевле.

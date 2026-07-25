# API

Все роуты: `app/api/**/route.ts`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
Идентичность резолвится через `resolveIdentity(req)` (`lib/http.ts`): заголовок
`x-vaultler-id` от `proxy.ts`, фолбэк — подписанная cookie, крайний случай — свежий id.

Общие правила:
- клиентское время, стек и буст **не принимаются** ни одним эндпоинтом;
- `429 { error: "rate_limited" }` при срабатывании лимита (см. `lib/ratelimit.ts`);
- ответы не содержат internal id (`dev:uuid`, `wallet:0x…`) — наружу идёт только адрес,
  и только если игрок не скрыл кошелёк.

---

## `GET /api/state`

Состояние игрока для отрисовки. **Read-only**: `settle` считается в памяти и не
персистится (стек детерминирован из таймстемпов), поэтому поллинг раз в 2.5 с дешёвый.

```jsonc
{
  "view": {                     // PublicView, см. game-mechanics.md
    "stack": 1234.5, "streak": 3, "multiplier": 1.6, "ratePerSec": 0.016,
    "phase": "winding",         // off | winding | ready | stall
    "tierIndex": 1, "tierName": "SAFE", "tierAt": 500,
    "gold": false, "nextTierAt": 2500, "nextTierName": "VAULT",
    "phaseEndsInMs": 42000, "boost": false, "serverNow": 1769000000000
  },
  "raid": { "lost": 180.2 } | null,   // если игрок как раз проспал окно
  "wallet": "0x…" | null,             // адрес, если сессия привязана к кошельку
  "nickname": "egor" | null,          // свой ник (для редактора)
  "hideWallet": false                 // своя настройка приватности
}
```

## `POST /api/crank`

Единственный способ завести машину. Тела запроса нет.
Rate-limit: `allowCrank` — не чаще **1 раза в секунду на идентичность**.

```jsonc
{ "ok": true, "reason": null, "raid": null, "view": { … } }
{ "ok": false, "reason": "winding", "raid": null, "view": { … } }   // завод ещё идёт
```

`ok: false` — это **200**, а не ошибка: сервер сообщает, что фаза не позволяет кранк.

## `GET /api/leaderboard`

Недельный борд и общий сейф. Считается по живому стеку (каждому `settle` на now).

```jsonc
{
  "communalVault": 918273.4,          // сумма живых стеков всего комьюнити
  "players": 240,
  "top": [{
    "rank": 1, "label": "egor",       // ник / короткий адрес / "anon" / имя бота
    "kind": "wallet",                 // wallet | anon | bot
    "address": "0x…" | null,          // null, если игрок скрыл кошелёк
    "stack": 40123.7, "streak": 12, "isYou": false
  }],
  "you": { "rank": 57, "stack": 812.3 } | null,
  "week": { "weekId": 133, "endsInMs": 259200000 }
}
```

Лимит топа — 10 (совпадает с зоной выплат). `snapshot()` тянет всех игроков —
на масштабе нужна пагинация или материализованный топ (см. `NOTES.md`).

## `POST /api/profile`

Ник и приватность адреса. Только для сессии с **подтверждённым кошельком** —
у анонимов личность = кука, которую легко сбросить, что открыло бы сквот ников.

```jsonc
// запрос: любое подмножество полей
{ "nickname": "egor" }     // "" или null — очистить ник
{ "hideWallet": true }
// успех
{ "ok": true, "nickname": "egor", "hideWallet": false, "view": { … } }
```

| Код | `error` | Причина |
|---|---|---|
| 403 | `wallet_required` | анонимная сессия |
| 400 | `too_short` / `too_long` / `bad_chars` / `reserved` / `bad` | валидация (`lib/profile.ts`) |
| 400 | `bad_body` / `nothing_to_update` | нет валидного JSON или нечего менять |
| 409 | `nickname_taken` | ник занят (включая гонку — Prisma P2002) |
| 429 | `rate_limited` | `allowProfile`, 30/мин на IP |

## `GET /api/auth/nonce`

Одноразовый nonce для SIWE. Кладётся в **httpOnly-cookie** `vaultler_nonce`
(TTL 5 мин) и дублируется в теле `{ "nonce": "…" }`.
Rate-limit: `allowNonce`, 40/мин на IP.

## `POST /api/auth/verify`

Проверка SIWE-подписи → идентичность = адрес кошелька.

```jsonc
// запрос
{ "message": "<SIWE EIP-4361 текст>", "signature": "0x…" }
// успех: ставит cookie сессии, гасит nonce
{ "ok": true, "identity": "wallet:0x…", "view": { … } }
```

| Код | `error` | Что не сошлось |
|---|---|---|
| 400 | `bad_body` / `bad_params` | не JSON, сообщение >2000 симв., подпись не hex |
| 400 | `nonce_missing` / `bad_message` | нет cookie с nonce, или адрес в сообщении невалиден |
| 401 | `message_rejected` | домен, nonce или срок действия не сошлись |
| 401 | `bad_signature` | подпись не принадлежит адресу из сообщения |
| 429 | `rate_limited` | `allowAuth`, 30/мин на IP |

Детали проверок — `docs/auth-session.md`.

## `POST /api/auth/logout`

Гасит cookie сессии. На следующем запросе `proxy.ts` заведёт свежую анонимную
dev-сессию — играть можно и без кошелька. Ответ: `{ "ok": true }`.

## `POST /api/boost/refresh`

Перечитать баланс $VLTR on-chain и обновить `boost` для текущего кошелька.
Для анонимной сессии — no-op с `boost: false`. Клиент буст не задаёт никогда.
Ответ: `{ "boost": true, "view": { … } }`.

## `GET /api/health`

Health-check для мониторинга и проверки после деплоя. Секретов не отдаёт.

```jsonc
{ "ok": true, "ts": 1769000000000,
  "checks": { "store": "postgres" | "file" | "error",
              "sessionSecret": "set" | "default",
              "chain": "configured" | "placeholder",
              "rateLimit": "shared" | "memory" } }
```

`503`, если стор не отвечает.

`rateLimit: "memory"` означает, что счётчики лимитов живут в памяти инстанса и на
serverless обходятся размазыванием запросов. Перед раздачей реальных призов здесь
должно быть `"shared"` (подключён Vercel KV / Upstash).

## Чего в API нет (и почему)

- **Нет эндпоинта, задающего стек/стрик/буст.** Любой такой роут = дырка в призовой пул.
- **Нет выплат.** Пул платится вручную вне сайта, кастодии нет (`docs/leaderboard-rewards.md`).
- **Нет админки.** Правки данных — только напрямую в БД, осознанно.

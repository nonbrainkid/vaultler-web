/**
 * Абстракция хранилища игроков.
 *
 * Ключевой метод — `mutate`: атомарный read-modify-write под локом на идентичность.
 * Без него два одновременных кранка могли бы прочитать один стейт и оба начислить стек
 * (классическая гонка, ведущая к накрутке). Файловый стор держит per-identity лок,
 * Prisma-стор — транзакцию.
 *
 * Выбор реализации: если задан DATABASE_URL → Postgres (Prisma), иначе → файловый (dev).
 */
import type { PlayerState } from "./game";
import type { WeekResultRecord } from "./week-results";

export interface PlayerSnapshot {
  identity: string;
  state: PlayerState;
}

export interface ProfilePatch {
  /** undefined — не менять; null — очистить; строка — установить (уже провалидирована). */
  nickname?: string | null;
  hideWallet?: boolean;
}

export interface SetProfileResult {
  ok: boolean;
  /** "nickname_taken", если ник уже занят другим игроком. */
  error?: string;
  state: PlayerState;
}

export interface MutateOutcome<R> {
  state: PlayerState;
  result: R;
}

/** Привязка identity ↔ chatId Telegram-бота напоминаний (спринт 1.1). */
export interface TelegramBinding {
  identity: string;
  chatId: number;
}

/**
 * Подписка браузера на веб-пуши (второй канал напоминаний).
 *
 * В отличие от Telegram связь НЕ 1:1: у игрока может быть телефон и ноутбук — по подписке на
 * каждое устройство. Уникален `endpoint` (его выдаёт push-сервис браузера), он же ключ
 * удаления. `identity` может у одного и того же endpoint'а поменяться: это тот же браузер
 * после входа кошельком (`dev:uuid` → `wallet:0x…`), и подписку надо перевесить, а не
 * плодить вторую.
 */
export interface PushSubscriptionRecord {
  identity: string;
  /** URL push-сервиса. Capability-ссылка: наружу не отдаётся, в логи и ключи KV не пишется. */
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Подряд неудачных отправок; успех обнуляет. Исчерпание = подписку удаляем. */
  failures: number;
  createdAt: number;
}

export interface LinkTelegramResult {
  /**
   * chatId, который был привязан к этому identity ДО вызова, если он отличался от нового.
   * `null` — либо это первая привязка, либо новый chatId совпадает со старым.
   * Вызывающий код обязан уведомить этот чат, что привязка перенесена (docs/brief-engineer.md,
   * "1:1 в обе стороны... повторная привязка заменяет старую и уведомляет старый чат").
   */
  displacedChatId: number | null;
}

/**
 * Запись журнала кранков. Пишется в ТОЙ ЖЕ транзакции, что и сам стейт: иначе при
 * падении между двумя записями журнал разошёлся бы с тем, что он описывает, и потерял
 * бы смысл как доказательство при разборе спора.
 */
export interface CrankAudit {
  /** Серверный epoch ms попытки. */
  at: number;
  ok: boolean;
  /** Фаза на момент попытки (до завода). */
  phase: string;
  /** Стрик и стек ПОСЛЕ кранка — точка отсчёта при разборе. */
  streak: number;
  stack: number;
  /** Сколько скимнул рейдер в этом же settle; null — рейда не было. */
  lostToRaid: number | null;
}

export interface Store {
  /**
   * Прочитать сохранённый стейт (или initialState для нового игрока) БЕЗ записи.
   * GET /state использует это и досчитывает settle в памяти только для отображения —
   * так поллинг не создаёт запись на каждый опрос. Персист происходит на кранке.
   */
  read(identity: string, now: number): Promise<PlayerState>;

  /**
   * Атомарно: загрузить-или-создать стейт игрока, применить `fn`, сохранить.
   * `fn` — чистая функция из lib/game (settle/crank). Возвращает новый стейт и произвольный результат.
   *
   * `audit` (опц.) вызывается уже с результатом `fn` и возвращает запись журнала либо
   * null, если писать нечего. Строка журнала сохраняется в той же транзакции.
   *
   * Здесь же фиксируется РЕЗУЛЬТАТ ЗАВЕРШЁННОЙ НЕДЕЛИ, если `fn` перевела игрока через
   * субботнюю границу (`closedWeekOf`, lib/week-results.ts). Это делает реализация стора,
   * а не вызывающий код: через `mutate` проходят все пути записи, и любой новый роут иначе
   * мог бы «забыть» зафиксировать неделю — ровно та же причина, по которой перевод недели
   * живёт внутри `settle`, а не в роутах.
   */
  mutate<R>(
    identity: string,
    now: number,
    fn: (state: PlayerState) => MutateOutcome<R>,
    audit?: (outcome: MutateOutcome<R>) => CrankAudit | null,
  ): Promise<MutateOutcome<R>>;

  /**
   * Все игроки со стейтами — для лидерборда и общего сейфа. Ранжирование/settle
   * делает сервисный слой (lib/leaderboard.ts), стор только отдаёт сырые данные.
   */
  snapshot(): Promise<PlayerSnapshot[]>;

  /**
   * Найти игрока по нику без учёта регистра (уникальность ника тоже без регистра) —
   * вход на публичную страницу `/u/[nick]`.
   *
   * Отдельный метод, а не фильтр по `snapshot()`: у неизвестного ника это единственное
   * обращение к базе, и оно обязано быть точечным. Страницу перебирают краулеры и боты,
   * и 404 не должен стоить чтения всей таблицы игроков (в Postgres здесь работает
   * уникальный индекс `nicknameKey`).
   *
   * `null` — ника нет ни у кого. Ник «есть, но публиковать нельзя» решается уже не здесь,
   * а в `lib/public-profile.ts`: стор отдаёт запись, правила публичности — сервисный слой.
   */
  playerByNickname(nick: string): Promise<PlayerSnapshot | null>;

  /**
   * Установить ник/приватность атомарно. Ник проверяется на глобальную уникальность
   * (без регистра); при коллизии — ok:false, error:"nickname_taken".
   */
  setProfile(
    identity: string,
    now: number,
    patch: ProfilePatch,
  ): Promise<SetProfileResult>;

  /**
   * Сохранить результаты недели. Идемпотентно по `(weekId, identity)`: повторный прогон
   * финализации не задваивает участника и не затирает уже проставленный `payoutTx`
   * (хеш выплаты вписывается вручную и потерять его нельзя — это доказательство платежа).
   *
   * Возвращает число записанных строк.
   */
  saveWeekResults(records: readonly WeekResultRecord[]): Promise<number>;

  /** Результаты недели, места сверху вниз; строки вне денег — в конце по приросту. */
  weekResults(weekId: number): Promise<WeekResultRecord[]>;

  /**
   * Номера закрытых недель, свежие первыми — для страницы `/payouts`.
   *
   * Отдельный метод, а не «прочитать всё и сгруппировать»: таблица растёт на десятки строк
   * каждую неделю и будет расти бессрочно, а странице нужен только список номеров плюс
   * несколько последних недель. `limit` обязателен по той же причине, по которой `snapshot()`
   * однажды придётся пагинировать (docs/roadmap.md, фаза 3).
   */
  closedWeekIds(limit: number): Promise<number[]>;

  /**
   * Связать identity ↔ chatId. Обеспечивает 1:1 в обе стороны: если у identity уже был
   * ДРУГОЙ chatId — старая запись удаляется (её chatId возвращается в `displacedChatId`);
   * если этот chatId уже был привязан к ДРУГОМУ identity — та запись тоже удаляется молча
   * (тот же физический чат сейчас же получит подтверждение новой привязки, отдельно
   * уведомлять некого — это тот же чат).
   */
  linkTelegram(identity: string, chatId: number, now: number): Promise<LinkTelegramResult>;

  /** Отвязать по identity (кнопка на сайте). Возвращает старый chatId, если он был. */
  unlinkTelegramByIdentity(identity: string): Promise<number | null>;

  /** Отвязать по chatId (команда /stop в боте). Возвращает identity, если он был. */
  unlinkTelegramByChatId(chatId: number): Promise<string | null>;

  /** Привязан ли этот identity, и к какому chatId. `null` — привязки нет. */
  telegramChatIdFor(identity: string): Promise<number | null>;

  /**
   * Все привязки разом — для крона рассылки: он проходит по игрокам (`snapshot`) и должен
   * дёшево узнать, у кого из них вообще есть chatId, без запроса на каждого игрока по
   * отдельности.
   */
  telegramLinks(): Promise<TelegramBinding[]>;

  /**
   * Сохранить (или обновить) подписку на веб-пуши. Ключ — `endpoint`: повторный вызов с тем
   * же endpoint'ом обновляет ключи и ПЕРЕВЕШИВАЕТ подписку на текущий identity, а не создаёт
   * вторую. Так браузер, вошедший кошельком после анонимной сессии, продолжает получать
   * напоминания одним устройством, а не двумя записями об одном и том же.
   * Счётчик неудач при перезаписи обнуляется: подписка только что подтверждена живой.
   */
  savePushSubscription(
    identity: string,
    sub: { endpoint: string; p256dh: string; auth: string },
    now: number,
  ): Promise<void>;

  /**
   * Удалить подписку СВОЕЙ сессии (кнопка «выключить напоминания» на сайте).
   * Ограничение по identity намеренное: endpoint приходит из тела запроса, и без проверки
   * владельца чужая страница могла бы отключить напоминания игроку, чей endpoint узнала.
   * `false` — такой подписки у этого игрока нет (идемпотентно, не ошибка).
   */
  deletePushSubscription(identity: string, endpoint: string): Promise<boolean>;

  /**
   * Удалить подписку по endpoint'у — для рассылки: push-сервис ответил 404/410 либо подписка
   * исчерпала попытки. Здесь владелец не проверяется: сигнал пришёл от самого сервиса, а не
   * из браузера.
   */
  deletePushSubscriptionByEndpoint(endpoint: string): Promise<boolean>;

  /** Сколько подписок у этого игрока — для статуса виджета (сами endpoint'ы наружу не идут). */
  countPushSubscriptions(identity: string): Promise<number>;

  /** Все подписки разом — для крона рассылки (как `telegramLinks`, по той же причине). */
  pushSubscriptions(): Promise<PushSubscriptionRecord[]>;

  /**
   * Записать результат отправки: успех обнуляет счётчик неудач, провал увеличивает.
   * Возвращает новое значение счётчика — по нему рассылка решает, пора ли удалять подписку
   * (`pushFailureExhausted`, lib/push-remind.ts). 0 для несуществующей записи.
   */
  notePushResult(endpoint: string, ok: boolean): Promise<number>;
}

let _store: Store | null = null;

export async function getStore(): Promise<Store> {
  if (_store) return _store;

  if (process.env.DATABASE_URL) {
    const { PrismaStore } = await import("./store-prisma");
    _store = new PrismaStore();
    return _store;
  }

  // Файловый стор — только для локальной разработки. Условие статически вычислимо
  // (бандлер подставляет NODE_ENV), поэтому в прод-сборке ветка вырезается вместе с
  // import("./store-file") — fs/path не попадают в serverless-бандл, а заодно уходит
  // build-варнинг Turbopack «whole project traced».
  if (process.env.NODE_ENV !== "production") {
    const { FileStore } = await import("./store-file");
    _store = new FileStore();
    return _store;
  }

  // Прод без DATABASE_URL: файловая ФС на Vercel эфемерна, стейт терялся бы молча
  // между деплоями и инстансами. Лучше упасть громко.
  throw new Error(
    "DATABASE_URL не задан в production. Подключите Vercel Postgres (docs/deployment.md).",
  );
}

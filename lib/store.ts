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

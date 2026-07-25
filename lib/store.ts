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

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

export interface LeaderboardEntry {
  identity: string;
  stack: number;
  streak: number;
}

export interface MutateOutcome<R> {
  state: PlayerState;
  result: R;
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
   */
  mutate<R>(
    identity: string,
    now: number,
    fn: (state: PlayerState) => MutateOutcome<R>,
  ): Promise<MutateOutcome<R>>;

  leaderboard(limit: number): Promise<LeaderboardEntry[]>;
}

let _store: Store | null = null;

export async function getStore(): Promise<Store> {
  if (_store) return _store;
  if (process.env.DATABASE_URL) {
    const { PrismaStore } = await import("./store-prisma");
    _store = new PrismaStore();
  } else {
    const { FileStore } = await import("./store-file");
    _store = new FileStore();
  }
  return _store;
}

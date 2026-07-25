/**
 * Файловый стор для локальной разработки (M1) — стейт живёт на сервере в .data/players.json.
 * НЕ для прода (нет конкурентной безопасности между процессами). В проде — Prisma/Postgres.
 *
 * Источник правды — ФАЙЛ, а не память процесса. Раньше файл читался один раз
 * (`ensureLoaded`), и дальше экземпляр жил своей копией. За долгую сессию правок Next-HMR
 * успевает создать несколько экземпляров модуля `lib/store.ts`, у каждого свой синглтон
 * `_store` и своя копия данных — и роуты начинали расходиться в показаниях. На игре это
 * выглядело как поломка петли: `POST /api/crank` заводил машину и писал файл, а
 * `GET /api/state` (другой экземпляр, копия снята до кранка) через 2.5 с поллинга отвечал
 * «machine is off, стек 0», и стакание визуально обрывалось через пару секунд после кранка.
 * Теперь перед каждой операцией проверяется отпечаток файла (mtime+размер) и копия
 * перечитывается, если её изменил кто-то ещё. Перезапуск dev-сервера больше не нужен.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { hydrateState, type PlayerState } from "./game";
import { nicknameKey } from "./profile";
import type {
  CrankAudit,
  MutateOutcome,
  PlayerSnapshot,
  ProfilePatch,
  SetProfileResult,
  Store,
} from "./store";

export class FileStore implements Store {
  private data: Record<string, PlayerState> | null = null;
  private file = path.join(process.cwd(), ".data", "players.json");
  /** Отпечаток файла на момент последнего чтения: несовпадение = копия в памяти устарела. */
  private stamp: string | null = null;
  /**
   * Единая очередь операций (а не лок на игрока, как было).
   *
   * Любая запись перезаписывает ФАЙЛ ЦЕЛИКОМ, поэтому параллелизм между игроками ничего
   * не давал, зато позволял потерять запись: пока игрок A персистит, операция игрока B
   * успевала перечитать файл (ещё без изменений A) и затереть их своим `persist`.
   * Один сериализованный поток проще и заведомо корректен, а настоящие построчные локи
   * есть там, где они нужны — в Prisma-сторе для прода.
   */
  private queue: Promise<unknown> = Promise.resolve();

  /** Выполнить работу строго по очереди (сериализует все операции стора). */
  private withQueue<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work);
    // В очереди держим «хвост», который не отвергается: иначе одна ошибка порвала бы
    // цепочку всем последующим операциям.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Синхронизировать копию в памяти с файлом.
   * Читаем заново только когда отпечаток изменился — обычный поллинг обходится одним `stat`.
   */
  private async ensureFresh(): Promise<void> {
    let stamp: string;
    try {
      const st = await fs.stat(this.file);
      stamp = `${st.mtimeMs}:${st.size}`;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        // Файла нет: чистый старт или сброс данных руками — оба случая означают «пусто».
        this.data = {};
        this.stamp = null;
        return;
      }
      // ФС ответила странно (на Windows файл может подержать антивирус/индексатор).
      // Работаем с тем, что есть в памяти, и сбрасываем отпечаток, чтобы следующая
      // операция попробовала перечитать снова.
      this.data ??= {};
      this.stamp = null;
      return;
    }

    if (this.data !== null && stamp === this.stamp) return;

    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as Record<string, unknown>;
      // Файл мог быть записан прошлой версией схемы (например, с булевым `boost`) —
      // приводим каждую запись к текущему PlayerState, а не доверяем ей на слово.
      const next: Record<string, PlayerState> = {};
      for (const [identity, state] of Object.entries(raw)) {
        next[identity] = hydrateState(state, Date.now());
      }
      this.data = next;
      this.stamp = stamp;
    } catch {
      // Файл есть, но не читается или это битый JSON. Не затираем память тем, чего не поняли.
      this.data ??= {};
      this.stamp = null;
    }
  }

  /** Записать файл и запомнить его новый отпечаток (чтобы не перечитывать свою же запись). */
  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2));
    try {
      const st = await fs.stat(this.file);
      this.stamp = `${st.mtimeMs}:${st.size}`;
    } catch {
      this.stamp = null; // не смогли подтвердить — пусть следующая операция перечитает
    }
  }

  async read(identity: string, now: number): Promise<PlayerState> {
    return this.withQueue(async () => {
      await this.ensureFresh();
      return hydrateState(this.data![identity], now);
    });
  }

  async mutate<R>(
    identity: string,
    now: number,
    fn: (state: PlayerState) => MutateOutcome<R>,
    // Журнал кранков намеренно не ведём: файловый стор — только для локальной разработки,
    // а журнал нужен для разбора споров о реальных призах, которых в dev не бывает.
    _audit?: (outcome: MutateOutcome<R>) => CrankAudit | null,
  ): Promise<MutateOutcome<R>> {
    return this.withQueue(async () => {
      await this.ensureFresh();
      const outcome = fn(hydrateState(this.data![identity], now));
      this.data![identity] = { ...outcome.state };
      await this.persist();
      return outcome;
    });
  }

  async snapshot(): Promise<PlayerSnapshot[]> {
    return this.withQueue(async () => {
      await this.ensureFresh();
      return Object.entries(this.data!).map(([identity, state]) => ({
        identity,
        state: { ...state },
      }));
    });
  }

  async setProfile(
    identity: string,
    now: number,
    patch: ProfilePatch,
  ): Promise<SetProfileResult> {
    return this.withQueue(async () => {
      await this.ensureFresh();
      const current = hydrateState(this.data![identity], now);

      if (patch.nickname !== undefined) {
        if (patch.nickname === null) {
          current.nickname = null;
        } else {
          const key = nicknameKey(patch.nickname);
          // Проверка уникальности видит всех разом: очередь гарантирует, что между
          // проверкой и записью никто другой ник не занял.
          const taken = Object.entries(this.data!).some(
            ([id, s]) => id !== identity && s.nickname && nicknameKey(s.nickname) === key,
          );
          if (taken) return { ok: false, error: "nickname_taken", state: current };
          current.nickname = patch.nickname;
        }
      }
      if (patch.hideWallet !== undefined) current.hideWallet = patch.hideWallet;

      this.data![identity] = current;
      await this.persist();
      return { ok: true, state: current };
    });
  }
}

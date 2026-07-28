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
import {
  addressOf,
  closedWeekOf,
  isPayoutEligible,
  type WeekResultRecord,
} from "./week-results";

export class FileStore implements Store {
  private data: Record<string, PlayerState> | null = null;
  private file = path.join(process.cwd(), ".data", "players.json");
  /**
   * Результаты недель лежат отдельным файлом: `players.json` — это словарь
   * `identity → PlayerState`, и подмешивать в него записи другой формы значило бы сломать
   * его схему (её читает `hydrateState` построчно).
   */
  private weeksFile = path.join(process.cwd(), ".data", "week-results.json");
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
      const before = hydrateState(this.data![identity], now);
      const outcome = fn(before);
      this.data![identity] = { ...outcome.state };
      await this.persist();

      // Тот же контракт, что и у прод-стора: переход через субботнюю границу фиксирует
      // результат закрытой недели. В dev это нужно, чтобы петлю «неделя → выплата» можно
      // было прогнать целиком на GAME_MODE=demo, не поднимая Postgres.
      const closed = closedWeekOf(before, outcome.state);
      if (closed) {
        const all = await this.readWeeks();
        const i = all.findIndex(
          (r) => r.weekId === closed.weekId && r.identity === identity,
        );
        if (i >= 0) {
          all[i] = { ...all[i], gain: closed.gain };
        } else {
          all.push({
            weekId: closed.weekId,
            identity,
            address: addressOf(identity),
            gain: closed.gain,
            rank: null,
            eligible: isPayoutEligible(identity),
            share: 0,
            payoutTx: null,
          });
        }
        await this.writeWeeks(all);
      }
      return outcome;
    });
  }

  /** Прочитать результаты недель. Файла нет или он битый → пусто (dev-стор). */
  private async readWeeks(): Promise<WeekResultRecord[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.weeksFile, "utf8"));
      return Array.isArray(raw) ? (raw as WeekResultRecord[]) : [];
    } catch {
      return [];
    }
  }

  private async writeWeeks(all: readonly WeekResultRecord[]): Promise<void> {
    await fs.mkdir(path.dirname(this.weeksFile), { recursive: true });
    await fs.writeFile(this.weeksFile, JSON.stringify(all, null, 2));
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

  async saveWeekResults(records: readonly WeekResultRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    return this.withQueue(async () => {
      const all = await this.readWeeks();
      for (const r of records) {
        const i = all.findIndex(
          (x) => x.weekId === r.weekId && x.identity === r.identity,
        );
        // payoutTx сохраняем прежний, если новый пустой: хеш выплаты вписывается вручную.
        if (i >= 0) all[i] = { ...r, payoutTx: r.payoutTx ?? all[i].payoutTx };
        else all.push(r);
      }
      await this.writeWeeks(all);
      return records.length;
    });
  }

  async weekResults(weekId: number): Promise<WeekResultRecord[]> {
    return this.withQueue(async () => {
      const all = await this.readWeeks();
      return all
        .filter((r) => r.weekId === weekId)
        .sort((a, b) => {
          if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
          if (a.rank !== null) return -1;
          if (b.rank !== null) return 1;
          return b.gain - a.gain;
        });
    });
  }
}

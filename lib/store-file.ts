/**
 * Файловый стор для локальной разработки (M1) — стейт живёт на сервере в .data/players.json.
 * НЕ для прода (нет конкурентной безопасности между процессами). В проде — Prisma/Postgres.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { initialState, type PlayerState } from "./game";
import { nicknameKey } from "./profile";
import type {
  MutateOutcome,
  PlayerSnapshot,
  ProfilePatch,
  SetProfileResult,
  Store,
} from "./store";

export class FileStore implements Store {
  private data: Record<string, PlayerState> | null = null;
  private file = path.join(process.cwd(), ".data", "players.json");
  private writeChain: Promise<void> = Promise.resolve();
  /** Per-identity локи: сериализуют read-modify-write по каждому игроку. */
  private locks = new Map<string, Promise<unknown>>();
  /** Глобальный лок на смену профиля: проверка уникальности ника видит всех разом. */
  private profileChain: Promise<unknown> = Promise.resolve();

  private async ensureLoaded(): Promise<void> {
    if (this.data) return;
    try {
      const raw = await fs.readFile(this.file, "utf8");
      this.data = JSON.parse(raw);
    } catch {
      this.data = {};
    }
  }

  private persist(): Promise<void> {
    this.writeChain = this.writeChain
      .then(async () => {
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        await fs.writeFile(this.file, JSON.stringify(this.data, null, 2));
      })
      .catch(() => {});
    return this.writeChain;
  }

  /** Выполнить работу под локом на identity (сериализует операции одного игрока). */
  private async withLock<T>(identity: string, work: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(identity) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    this.locks.set(identity, prev.then(() => gate));
    await prev.catch(() => {});
    try {
      return await work();
    } finally {
      release();
      if (this.locks.get(identity) === gate) this.locks.delete(identity);
    }
  }

  async read(identity: string, now: number): Promise<PlayerState> {
    await this.ensureLoaded();
    return { ...(this.data![identity] ?? initialState(now)) };
  }

  async mutate<R>(
    identity: string,
    now: number,
    fn: (state: PlayerState) => MutateOutcome<R>,
  ): Promise<MutateOutcome<R>> {
    await this.ensureLoaded();
    return this.withLock(identity, async () => {
      const current = this.data![identity] ?? initialState(now);
      const outcome = fn({ ...current });
      this.data![identity] = { ...outcome.state };
      await this.persist();
      return outcome;
    });
  }

  async snapshot(): Promise<PlayerSnapshot[]> {
    await this.ensureLoaded();
    return Object.entries(this.data!).map(([identity, state]) => ({
      identity,
      state: { ...state },
    }));
  }

  async setProfile(
    identity: string,
    now: number,
    patch: ProfilePatch,
  ): Promise<SetProfileResult> {
    await this.ensureLoaded();
    // Сериализуем ВСЕ смены профиля: иначе два игрока могли бы одновременно пройти
    // проверку «ник свободен» и оба его занять (per-identity лок этого не ловит).
    const run = this.profileChain.then(() =>
      this.withLock(identity, async () => {
      const current: PlayerState = { ...(this.data![identity] ?? initialState(now)) };

      if (patch.nickname !== undefined) {
        if (patch.nickname === null) {
          current.nickname = null;
        } else {
          const key = nicknameKey(patch.nickname);
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
      }),
    ) as Promise<SetProfileResult>;
    this.profileChain = run.catch(() => {});
    return run;
  }
}

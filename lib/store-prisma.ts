/**
 * Postgres-стор через Prisma. Активируется, когда задан DATABASE_URL (прод / Vercel Postgres).
 * read-modify-write обёрнут в транзакцию; строку игрока лочим FOR UPDATE, чтобы два
 * одновременных кранка не начислили стек дважды.
 */
import { PrismaClient } from "./generated/prisma";
import { initialState, type PlayerState } from "./game";
import { nicknameKey } from "./profile";
import type {
  CrankAudit,
  MutateOutcome,
  PlayerSnapshot,
  ProfilePatch,
  SetProfileResult,
  Store,
} from "./store";

// Синглтон клиента (иначе dev-hot-reload плодит подключения).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type Row = {
  stack: number;
  streak: number;
  lastCrankAt: bigint | null;
  lastSettleAt: bigint;
  machineOn: boolean;
  boost: boolean;
  nickname: string | null;
  hideWallet: boolean;
};

function toState(row: Row): PlayerState {
  return {
    stack: row.stack,
    streak: row.streak,
    lastCrankAt: row.lastCrankAt === null ? null : Number(row.lastCrankAt),
    lastSettleAt: Number(row.lastSettleAt),
    machineOn: row.machineOn,
    boost: row.boost,
    nickname: row.nickname ?? null,
    hideWallet: row.hideWallet ?? false,
  };
}

function toWrite(s: PlayerState) {
  return {
    stack: s.stack,
    streak: s.streak,
    lastCrankAt: s.lastCrankAt === null ? null : BigInt(Math.trunc(s.lastCrankAt)),
    lastSettleAt: BigInt(Math.trunc(s.lastSettleAt)),
    machineOn: s.machineOn,
    boost: s.boost,
    nickname: s.nickname,
    nicknameKey: s.nickname ? nicknameKey(s.nickname) : null,
    hideWallet: s.hideWallet,
  };
}

export class PrismaStore implements Store {
  async read(identity: string, now: number): Promise<PlayerState> {
    const row = (await prisma.player.findUnique({ where: { identity } })) as Row | null;
    return row ? toState(row) : initialState(now);
  }

  async mutate<R>(
    identity: string,
    now: number,
    fn: (state: PlayerState) => MutateOutcome<R>,
    audit?: (outcome: MutateOutcome<R>) => CrankAudit | null,
  ): Promise<MutateOutcome<R>> {
    return prisma.$transaction(async (tx) => {
      // Лочим строку игрока на время транзакции (если существует).
      await tx.$executeRaw`SELECT 1 FROM "Player" WHERE identity = ${identity} FOR UPDATE`;
      const row = (await tx.player.findUnique({ where: { identity } })) as Row | null;
      const state = row ? toState(row) : initialState(now);
      const outcome = fn(state);
      const data = toWrite(outcome.state);
      // upsert возвращает строку — из неё берём playerId для журнала (у нового игрока
      // id появляется только здесь).
      const player = await tx.player.upsert({
        where: { identity },
        create: { identity, ...data },
        update: data,
        select: { id: true },
      });

      const entry = audit?.(outcome) ?? null;
      if (entry) {
        await tx.crankLog.create({
          data: {
            playerId: player.id,
            at: BigInt(Math.trunc(entry.at)),
            ok: entry.ok,
            phase: entry.phase,
            streak: entry.streak,
            stack: entry.stack,
            lostToRaid: entry.lostToRaid,
          },
        });
      }
      return outcome;
    });
  }

  async snapshot(): Promise<PlayerSnapshot[]> {
    const rows = (await prisma.player.findMany()) as (Row & { identity: string })[];
    return rows.map((r) => ({ identity: r.identity, state: toState(r) }));
  }

  async setProfile(
    identity: string,
    now: number,
    patch: ProfilePatch,
  ): Promise<SetProfileResult> {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM "Player" WHERE identity = ${identity} FOR UPDATE`;
        const row = (await tx.player.findUnique({ where: { identity } })) as Row | null;
        const state = row ? toState(row) : initialState(now);

        if (patch.nickname !== undefined) {
          if (patch.nickname === null) {
            state.nickname = null;
          } else {
            const key = nicknameKey(patch.nickname);
            const clash = await tx.player.findFirst({
              where: { nicknameKey: key, NOT: { identity } },
              select: { id: true },
            });
            if (clash) return { ok: false, error: "nickname_taken", state };
            state.nickname = patch.nickname;
          }
        }
        if (patch.hideWallet !== undefined) state.hideWallet = patch.hideWallet;

        const data = toWrite(state);
        await tx.player.upsert({
          where: { identity },
          create: { identity, ...data },
          update: data,
        });
        return { ok: true, state };
      });
    } catch (e) {
      // Гонка: findFirst у обоих прошёл, но unique-констрейнт nicknameKey отверг второго.
      // Возвращаем чистый taken вместо 500.
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2002") {
        return { ok: false, error: "nickname_taken", state: await this.read(identity, now) };
      }
      throw e;
    }
  }
}

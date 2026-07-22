/**
 * Postgres-стор через Prisma. Активируется, когда задан DATABASE_URL (прод / Vercel Postgres).
 * read-modify-write обёрнут в транзакцию; строку игрока лочим FOR UPDATE, чтобы два
 * одновременных кранка не начислили стек дважды.
 */
import { PrismaClient } from "./generated/prisma";
import { initialState, type PlayerState } from "./game";
import type { LeaderboardEntry, MutateOutcome, Store } from "./store";

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
};

function toState(row: Row): PlayerState {
  return {
    stack: row.stack,
    streak: row.streak,
    lastCrankAt: row.lastCrankAt === null ? null : Number(row.lastCrankAt),
    lastSettleAt: Number(row.lastSettleAt),
    machineOn: row.machineOn,
    boost: row.boost,
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
  ): Promise<MutateOutcome<R>> {
    return prisma.$transaction(async (tx) => {
      // Лочим строку игрока на время транзакции (если существует).
      await tx.$executeRaw`SELECT 1 FROM "Player" WHERE identity = ${identity} FOR UPDATE`;
      const row = (await tx.player.findUnique({ where: { identity } })) as Row | null;
      const state = row ? toState(row) : initialState(now);
      const outcome = fn(state);
      const data = toWrite(outcome.state);
      await tx.player.upsert({
        where: { identity },
        create: { identity, ...data },
        update: data,
      });
      return outcome;
    });
  }

  async leaderboard(limit: number): Promise<LeaderboardEntry[]> {
    return prisma.player.findMany({
      orderBy: { stack: "desc" },
      take: limit,
      select: { identity: true, stack: true, streak: true },
    });
  }
}

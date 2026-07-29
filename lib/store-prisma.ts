/**
 * Postgres-стор через Prisma. Активируется, когда задан DATABASE_URL (прод / Vercel Postgres).
 * read-modify-write обёрнут в транзакцию; строку игрока лочим FOR UPDATE, чтобы два
 * одновременных кранка не начислили стек дважды.
 */
import { PrismaClient } from "./generated/prisma";
import { clampHolderLevel, initialState, type PlayerState } from "./game";
import { nicknameKey } from "./profile";
import type {
  CrankAudit,
  LinkTelegramResult,
  MutateOutcome,
  PlayerSnapshot,
  ProfilePatch,
  SetProfileResult,
  Store,
  TelegramBinding,
} from "./store";
import {
  addressOf,
  closedWeekOf,
  isPayoutEligible,
  type WeekResultRecord,
} from "./week-results";

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
  boostTier: number;
  boostPpb: number;
  weekId: number;
  weekStartStack: number;
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
    // clamp, а не доверие колонке: значение вне лестницы тиров означало бы неизвестный
    // множитель, и трактовать его надо как «буста нет», а не как максимальный.
    boostTier: clampHolderLevel(row.boostTier),
    boostPpb: Math.max(0, Number(row.boostPpb) || 0),
    weekId: Number(row.weekId) || 0,
    weekStartStack: Math.max(0, Number(row.weekStartStack) || 0),
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
    boostTier: s.boostTier,
    // ppb — целое (Int в схеме): доля ≤ 1e9, дробные доли ppb на пороги не влияют.
    boostPpb: Math.round(s.boostPpb),
    weekId: s.weekId,
    weekStartStack: s.weekStartStack,
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

      // Игрок перешёл через субботнюю границу — фиксируем результат закрытой недели ЗДЕСЬ,
      // в той же транзакции, что и стейт. Позже это уже не восстановить: база недели
      // (`weekStartStack`) только что перезаписана, и прирост прошлой недели из стейта
      // больше не выводится.
      const closed = closedWeekOf(state, outcome.state);
      if (closed) {
        await tx.weekResult.upsert({
          where: { weekId_identity: { weekId: closed.weekId, identity } },
          create: {
            weekId: closed.weekId,
            identity,
            address: addressOf(identity),
            gain: closed.gain,
            eligible: isPayoutEligible(identity),
          },
          // Место, долю и хеш выплаты не трогаем: их проставляет финализация недели,
          // и она может пройти раньше, чем проспавший игрок вернётся.
          update: { gain: closed.gain },
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

  async saveWeekResults(records: readonly WeekResultRecord[]): Promise<number> {
    if (records.length === 0) return 0;
    // Одной транзакцией: неделя финализируется целиком либо не финализируется вовсе.
    // Полуразмеченная неделя — это борд, где часть мест «в деньгах», а часть нет, и
    // отличить незаконченную запись от законной невозможно.
    await prisma.$transaction(
      records.map((r) =>
        prisma.weekResult.upsert({
          where: { weekId_identity: { weekId: r.weekId, identity: r.identity } },
          create: {
            weekId: r.weekId,
            identity: r.identity,
            address: r.address,
            gain: r.gain,
            rank: r.rank,
            eligible: r.eligible,
            share: r.share,
            payoutTx: r.payoutTx,
          },
          update: {
            address: r.address,
            gain: r.gain,
            rank: r.rank,
            eligible: r.eligible,
            share: r.share,
            // payoutTx перезаписываем ТОЛЬКО непустым значением: хеш вписывается вручную
            // после отправки токенов, и повторный прогон финализации не должен стирать
            // доказательство платежа.
            ...(r.payoutTx ? { payoutTx: r.payoutTx } : {}),
          },
        }),
      ),
    );
    return records.length;
  }

  async weekResults(weekId: number): Promise<WeekResultRecord[]> {
    const rows = await prisma.weekResult.findMany({
      where: { weekId },
      orderBy: [{ rank: { sort: "asc", nulls: "last" } }, { gain: "desc" }],
    });
    return rows.map((r) => ({
      weekId: r.weekId,
      identity: r.identity,
      address: r.address,
      gain: r.gain,
      rank: r.rank,
      eligible: r.eligible,
      share: r.share,
      payoutTx: r.payoutTx,
    }));
  }

  async closedWeekIds(limit: number): Promise<number[]> {
    // distinct по weekId вместо выгрузки всех строк: таблица растёт бессрочно, а странице
    // нужен только список номеров. Индекс `@@index([weekId, rank])` покрывает сортировку.
    const rows = await prisma.weekResult.findMany({
      distinct: ["weekId"],
      select: { weekId: true },
      orderBy: { weekId: "desc" },
      take: Math.max(1, Math.trunc(limit)),
    });
    return rows.map((r) => r.weekId);
  }

  async linkTelegram(identity: string, chatId: number): Promise<LinkTelegramResult> {
    return prisma.$transaction(async (tx) => {
      const byIdentity = await tx.telegramLink.findUnique({ where: { identity } });
      const byChatId = await tx.telegramLink.findUnique({ where: { chatId: BigInt(chatId) } });

      let displacedChatId: number | null = null;
      if (byIdentity && Number(byIdentity.chatId) !== chatId) {
        displacedChatId = Number(byIdentity.chatId);
        await tx.telegramLink.delete({ where: { identity } });
      }
      // Тот же chatId уже занят ДРУГИМ identity: 1:1 в обе стороны — освобождаем его
      // молча. Уведомлять некого отдельно: это тот же физический чат, который сейчас же
      // получит подтверждение новой привязки.
      if (byChatId && byChatId.identity !== identity) {
        await tx.telegramLink.delete({ where: { chatId: BigInt(chatId) } });
      }

      await tx.telegramLink.upsert({
        where: { identity },
        create: { identity, chatId: BigInt(chatId) },
        update: { chatId: BigInt(chatId) },
      });
      return { displacedChatId };
    });
  }

  async unlinkTelegramByIdentity(identity: string): Promise<number | null> {
    try {
      const row = await prisma.telegramLink.delete({ where: { identity } });
      return Number(row.chatId);
    } catch (e) {
      // P2025 — записи не было. Это не ошибка, а "нечего отвязывать".
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2025") {
        return null;
      }
      throw e;
    }
  }

  async unlinkTelegramByChatId(chatId: number): Promise<string | null> {
    try {
      const row = await prisma.telegramLink.delete({ where: { chatId: BigInt(chatId) } });
      return row.identity;
    } catch (e) {
      if (e && typeof e === "object" && "code" in e && (e as { code?: string }).code === "P2025") {
        return null;
      }
      throw e;
    }
  }

  async telegramChatIdFor(identity: string): Promise<number | null> {
    const row = await prisma.telegramLink.findUnique({ where: { identity } });
    return row ? Number(row.chatId) : null;
  }

  async telegramLinks(): Promise<TelegramBinding[]> {
    const rows = await prisma.telegramLink.findMany();
    return rows.map((r) => ({ identity: r.identity, chatId: Number(r.chatId) }));
  }
}

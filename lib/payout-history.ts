/**
 * Публичный вид истории выплат для страницы `/payouts` (задача 1.4, docs/roadmap.md).
 *
 * Зачем страница вообще: пост с хешами утонет в ленте через день, а доказательство выплат —
 * единственный актив, которого нет у остальных мем-токенов, и жить он должен по постоянному
 * адресу. Отсюда же CM берёт ссылку для субботнего поста (docs/brief-community.md).
 *
 * ГЛАВНАЯ ОСТОРОЖНОСТЬ ЗДЕСЬ — ПРИВАТНОСТЬ. В `WeekResult` лежит `identity` (`wallet:0x…`,
 * `dev:uuid`) и адрес **даже у тех, кто включил `hideWallet`**: адрес там нужен, чтобы
 * отправить выплату, а не чтобы его показывать. Рендер записи «как есть» раскрыл бы и
 * internal id, и адрес игрока, который его осознанно скрыл, — то есть сломал бы инвариант 5
 * в новом месте. Поэтому наружу запись превращается ТОЛЬКО здесь, и только через
 * `toPayoutRows`, а тесты следят, что `identity` не утекает ни в одном поле.
 *
 * Ник и флаг приватности живут в текущем стейте игрока, а не в записи недели, поэтому
 * строки джойнятся со снапшотом. Игрок, которого в снапшоте нет (запись старше, чем
 * игрок в базе), деградирует до короткого адреса — не до пустой строки.
 */
import type { PlayerState } from "./game";
import type { WeekResultRecord } from "./week-results";

export interface PayoutRow {
  /** Место в деньгах (1…10) либо null — участвовал, но вне призовой зоны. */
  rank: number | null;
  /** Ник, короткий адрес или «anon». Internal id сюда не попадает никогда. */
  label: string;
  /** Полный адрес для ссылки в эксплорер. null — игрок скрыл адрес или его нет вовсе. */
  address: string | null;
  /** Прирост стека за неделю — то, по чему ранжировали. */
  gain: number;
  /** Доля пула для места, в процентах. 0 — вне денег. */
  sharePct: number;
  /** Хеш транзакции выплаты. null — ещё не отправлено (или места в деньгах нет). */
  payoutTx: string | null;
  eligible: boolean;
}

export interface PayoutWeek {
  weekId: number;
  rows: PayoutRow[];
  /** Сколько мест в деньгах фактически занято — по ним и перенормированы доли. */
  paidSeats: number;
  /** Сколько из них уже подтверждены хешем транзакции. */
  paidTxCount: number;
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

/**
 * Ярлык строки. Повторяет правила борда (lib/leaderboard.ts → displayFor), но берёт данные
 * из двух источников: адрес — из записи недели (он зафиксирован на момент закрытия и не
 * должен меняться задним числом, если игрок потом сменил кошелёк), ник и приватность — из
 * текущего стейта.
 */
function labelFor(rec: WeekResultRecord, state: PlayerState | undefined): PayoutRow {
  const hidden = state?.hideWallet === true;
  const nickname = state?.nickname ?? null;
  const addr = rec.address;

  // Скрывший адрес остаётся в списке и остаётся eligible: адрес у нас есть, наружу он
  // просто не идёт. Это ровно то поведение, что уже описано игроку в UI приватности.
  const address = hidden ? null : addr;
  const label = nickname ?? (addr !== null && !hidden ? shortAddr(addr) : "anon");

  return {
    rank: rec.rank,
    label,
    address,
    gain: rec.gain,
    sharePct: Math.round(rec.share * 1000) / 10,
    payoutTx: rec.payoutTx,
    eligible: rec.eligible,
  };
}

/**
 * Записи недели → строки для показа. Сортировка: сначала места в деньгах по возрастанию
 * ранга, затем остальные по убыванию прироста — тот же порядок, в котором неделя
 * финализировалась, чтобы страница не противоречила борду.
 */
export function toPayoutRows(
  records: readonly WeekResultRecord[],
  states: ReadonlyMap<string, PlayerState>,
): PayoutRow[] {
  return records
    .map((r) => labelFor(r, states.get(r.identity)))
    .sort((a, b) => {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return b.gain - a.gain;
    });
}

/** Свод по неделе: строки плюс два числа, по которым видно, всё ли выплачено. */
export function toPayoutWeek(
  weekId: number,
  records: readonly WeekResultRecord[],
  states: ReadonlyMap<string, PlayerState>,
): PayoutWeek {
  const rows = toPayoutRows(records, states);
  const inMoney = rows.filter((r) => r.rank !== null);
  return {
    weekId,
    rows,
    paidSeats: inMoney.length,
    // Считаем только по местам в деньгах: хеш у строки вне призовой зоны означал бы
    // выплату, которой не должно было быть, и такое лучше увидеть как расхождение.
    paidTxCount: inMoney.filter((r) => r.payoutTx !== null && r.payoutTx !== "").length,
  };
}

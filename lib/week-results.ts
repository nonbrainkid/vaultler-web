/**
 * Результаты завершённых недель: кто с каким приростом закончил неделю и кому платить.
 *
 * ЗАЧЕМ ЭТО НУЖНО. Ранг на борде считается на лету как `stack - weekStartStack`, а
 * `weekStartStack` перезаписывается внутри `settle` при первом же обращении игрока после
 * субботней полуночи. То есть в момент сброса список победителей ПЕРЕСТАЁТ СУЩЕСТВОВАТЬ:
 * восстанавливать его пришлось бы вручную по `CrankLog`, приблизительно и задним числом —
 * в споре с людьми, которым обещаны реальные токены. Поэтому прирост фиксируется ровно
 * тогда, когда игрок переходит на новую неделю, и больше не зависит от того, что случится
 * с его стеком дальше.
 *
 * Модуль чистый: не читает время, env и БД. Список исключённых кошельков и момент
 * финализации передаёт вызывающий код (`app/api/admin/close-week`).
 */
import type { PlayerState } from "./game";
import { PAYOUT_SEATS, payoutShare } from "./payout";

/** Факт: игрок закончил неделю `weekId` с приростом `gain`. */
export interface ClosedWeek {
  weekId: number;
  gain: number;
}

/**
 * Обнаружить закрытие недели по паре «стейт до» / «стейт после» одной мутации.
 *
 * Работает без изменения сигнатуры `settle`, потому что переход недели там уже оставляет
 * след: `weekStartStack` становится стеком НА МОМЕНТ ГРАНИЦЫ (`lib/game.ts` → `settle`).
 * Значит прирост закрытой недели — это разница двух баз, а не что-то, что нужно считать
 * отдельно и рисковать разойтись с бордом (борд ранжирует по `stack - weekStartStack`).
 *
 * `weekId === 0` у `prev` означает «игрок ещё не был ни в одной неделе» (свежая запись или
 * стейт до введения недельного цикла) — закрывать нечего.
 *
 * Игрок, проспавший несколько недель подряд, закрывает их одной записью на самой ранней:
 * `settle` докручивает его сразу до границы ТЕКУЩЕЙ недели. Потери нет — всё это время
 * его машина стояла и стек не рос, — но по этой причине `gain` таких записей нулевой.
 */
export function closedWeekOf(prev: PlayerState, next: PlayerState): ClosedWeek | null {
  if (prev.weekId === next.weekId) return null;
  if (prev.weekId === 0) return null;
  return {
    weekId: prev.weekId,
    // max(0,…) страхует от отрицательного значения: рейдер мог скимнуть долю стека уже
    // после того, как база недели была зафиксирована.
    gain: Math.max(0, next.weekStartStack - prev.weekStartStack),
  };
}

/**
 * Может ли игрок получить выплату.
 *
 * Нужен подтверждённый кошелёк — не из вредности, а потому что анонимной сессии токены
 * отправить физически некуда: у неё нет адреса ни на борде, ни в базе. Вдобавок такая
 * сессия создаётся бесплатно в один клик в режиме инкогнито, то есть один человек мог бы
 * занять весь топ-10 и забрать пул целиком (лестница `HOLDER_TIERS` от этого не защищает —
 * она удорожает дробление БЭГА, а не заведение пустых сессий).
 *
 * Скрывший адрес (`hideWallet`) остаётся eligible: адрес у нас есть, наружу он просто не
 * отдаётся. Не путать с `kind: "anon"` на борде, где кошелька нет вовсе.
 */
export function isPayoutEligible(identity: string, excluded?: Set<string>): boolean {
  if (identity.startsWith("bot:")) return false;
  const addr = addressOf(identity);
  if (addr === null) return false;
  // Кошельки команды: на сайте написано «nothing goes to the team», и место в призовой
  // зоне этому прямо противоречит.
  if (excluded && excluded.has(addr)) return false;
  return true;
}

/**
 * Адрес из идентичности в нижнем регистре или null.
 *
 * Формат идентичности задаёт `lib/auth.ts` (`wallet:0x…`); здесь он разбирается локально,
 * чтобы модуль результатов недели не тянул за собой SIWE-слой ради одной строки.
 */
export function addressOf(identity: string): string | null {
  if (!identity.startsWith("wallet:")) return null;
  const addr = identity.slice("wallet:".length).toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(addr) ? addr : null;
}

/** Строка результата недели — то, что хранится и по чему платят. */
export interface WeekResultRecord {
  weekId: number;
  /** Internal id. Наружу НЕ отдаётся — только адрес. */
  identity: string;
  /** Адрес на момент закрытия недели: по нему делается ручная выплата. */
  address: string | null;
  /** Прирост стека за неделю — то, по чему ранжируют. */
  gain: number;
  /** Место в призовой зоне (1…10) или null, если вне денег. */
  rank: number | null;
  eligible: boolean;
  /** Доля пула для этого места (0…1). 0 — вне денег. */
  share: number;
  /** Хеш транзакции выплаты. Проставляется вручную после отправки токенов. */
  payoutTx: string | null;
}

export interface WeekEntry {
  identity: string;
  gain: number;
}

/**
 * Проставить места и доли пула по списку участников недели.
 *
 * Ранг — свойство всей таблицы, а не отдельного игрока, поэтому при ленивом закрытии
 * (игрок за игроком, каждый в своей транзакции) он неизвестен и остаётся null. Здесь
 * неделя финализируется целиком.
 *
 * ГЛАВНОЕ ПРАВИЛО: призовые места считаются по первым `PAYOUT_SEATS` **eligible**, а не по
 * первым десяти строкам борда. Аноним с большим приростом остаётся выше в общем зачёте и
 * виден на борде — но пул делят подтверждённые кошельки, иначе часть пула оказалась бы
 * «ничьей», а объявлять её и не платить хуже, чем не объявлять.
 *
 * Нулевой прирост места не занимает: платить за неучастие не за что, и без этого правила
 * пустые сессии добирали бы хвост призовой зоны.
 */
export function finalizeWeek(
  weekId: number,
  entries: readonly WeekEntry[],
  excluded?: Set<string>,
): WeekResultRecord[] {
  const sorted = [...entries].sort((a, b) => b.gain - a.gain);

  let seat = 0;
  return sorted.map((e) => {
    const eligible = isPayoutEligible(e.identity, excluded);
    const inMoney = eligible && e.gain > 0 && seat < PAYOUT_SEATS;
    const rank = inMoney ? ++seat : null;
    return {
      weekId,
      identity: e.identity,
      address: addressOf(e.identity),
      gain: e.gain,
      rank,
      eligible,
      // Доля считается после того, как известно ФАКТИЧЕСКОЕ число занятых мест, — иначе
      // при неполной десятке часть пула повисла бы нераспределённой. Проставляем ниже.
      share: 0,
      payoutTx: null,
    };
  });
}

/**
 * Досчитать доли пула, когда известно итоговое число занятых мест.
 *
 * Отдельным проходом, потому что `payoutShare` перенормирует веса на фактическое `K`
 * (`lib/payout.ts`), а `K` становится известен только когда размечены все строки.
 */
export function withShares(records: readonly WeekResultRecord[]): WeekResultRecord[] {
  const seats = records.filter((r) => r.rank !== null).length;
  return records.map((r) => ({
    ...r,
    share: r.rank === null ? 0 : payoutShare(r.rank, seats),
  }));
}

/** Финализация целиком: места, затем доли. */
export function finalizeWeekWithShares(
  weekId: number,
  entries: readonly WeekEntry[],
  excluded?: Set<string>,
): WeekResultRecord[] {
  return withShares(finalizeWeek(weekId, entries, excluded));
}

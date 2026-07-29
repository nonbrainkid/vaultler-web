/**
 * Лидерборд и «общий сейф» — считаются на сервере из снапшота всех игроков.
 * Каждому игроку применяем settle на текущий момент, чтобы цифры были честные
 * (у зарейженных/накапавших — актуальные), а не устаревший stored-stack.
 *
 * Приватность: наружу отдаём ярлык (ник / короткий адрес / «anon») и — если игрок НЕ
 * скрыл кошелёк — полный адрес для ссылки на explorer. Скрыл → адрес не уходит вообще.
 * Сырые внутренние id (dev:uuid) наружу никогда не отдаём.
 */
import { settle, type PlayerState } from "./game";
import { addressFromIdentity } from "./auth";
import { PAYOUT_SEATS } from "./payout";
import type { PlayerSnapshot } from "./store";
import { isPayoutEligible, occupiesSeat } from "./week-results";
import { weekInfo, type WeekInfo } from "./week";

export { weekInfo };
export type { WeekInfo };

export interface LeaderRow {
  rank: number;
  label: string;
  kind: "wallet" | "anon" | "bot";
  /** Полный адрес для ссылки на explorer — только если игрок НЕ скрыл кошелёк. */
  address: string | null;
  /** Прирост стека ЗА ЭТУ НЕДЕЛЮ — именно по нему ранжируется борд. */
  stack: number;
  /** Накопленный за всё время стек: показываем справочно, на ранг не влияет. */
  lifetimeStack: number;
  streak: number;
  isYou: boolean;
  /**
   * Может ли игрок получить выплату: нужен подтверждённый кошелёк.
   * Анонимной сессии токены отправить некуда, и заводится она бесплатно в один клик —
   * см. `isPayoutEligible` в lib/week-results.ts.
   */
  eligible: boolean;
  /**
   * Место в призовой зоне (1…10) или null, если вне денег.
   *
   * С 2026-07-28 место занимает и аноним, поэтому для верхних строк `moneyRank` совпадает
   * с `rank`. Расходятся они там, где выше стоят боты или кошельки команды: те мест не
   * занимают вовсе. `eligible` при этом отвечает на другой вопрос — заплатят ли по этому
   * месту или его доля сгорит.
   */
  moneyRank: number | null;
}

export interface LeaderboardView {
  communalVault: number; // сумма живых стеков всего комьюнити
  players: number;
  top: LeaderRow[];
  you: {
    rank: number;
    stack: number;
    eligible: boolean;
    moneyRank: number | null;
  } | null;
  week: WeekInfo;
  /** Сколько мест в деньгах вообще бывает — чтобы клиент не хардкодил десятку. */
  payoutSeats: number;
}

/**
 * Кошельки команды: играют как все, но в борде и призовом пуле не участвуют.
 *
 * На сайте написано «nothing goes to the team». Кошелёк разработчика в топ-10, который
 * делит реальные токены, прямо этому противоречит — и это первое, что найдут, когда
 * начнут проверять выплаты. Поэтому исключение делается не «спрятать строку в вёрстке»,
 * а вырезать игрока из САМОГО расчёта: он не занимает место, не попадает в счётчик
 * игроков и не раздувает общий сейф. Раз выплаты делаются руками по этому борду,
 * «нет в борде» и означает «не получает».
 *
 * Список — в серверной переменной `BOARD_EXCLUDE` (адреса через запятую). Не в коде,
 * потому что состав команды меняется чаще, чем выходит релиз; не в базе, чтобы не
 * мигрировать живую таблицу ради конфигурации. Наружу список не отдаётся никогда.
 */
export function parseExcluded(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(/[\s,;]+/)) {
    const addr = part.trim().toLowerCase();
    // Мусор молча игнорируем: опечатка в env не должна выкидывать из борда случайного
    // игрока и не должна ронять борд целиком.
    if (/^0x[0-9a-f]{40}$/.test(addr)) out.add(addr);
  }
  return out;
}

/** Исключён ли игрок из борда. Сравниваем по адресу кошелька, регистр не важен. */
function isExcluded(identity: string, excluded: Set<string>): boolean {
  if (excluded.size === 0) return false;
  const addr = addressFromIdentity(identity);
  return addr !== null && excluded.has(addr.toLowerCase());
}

function shortAddr(a: string): string {
  return a.slice(0, 6) + "…" + a.slice(-4);
}

interface Display {
  label: string;
  kind: "wallet" | "anon" | "bot";
  address: string | null;
}

function displayFor(identity: string, state: PlayerState): Display {
  // Засеянные для тестов боты помечаются явно (борд делит реальные токены).
  if (identity.startsWith("bot:")) {
    return { label: identity.slice("bot:".length), kind: "bot", address: null };
  }

  const nick = state.nickname?.trim() || null;
  const addr = addressFromIdentity(identity);

  if (addr) {
    if (state.hideWallet) {
      // Скрыто: ник или «anon», адрес наружу НЕ уходит.
      return { label: nick || "anon", kind: "wallet", address: null };
    }
    // Открыто: ник (или короткий адрес) + полный адрес для explorer-ссылки.
    return { label: nick || shortAddr(addr), kind: "wallet", address: addr };
  }

  // Анонимная dev-сессия — ника быть не должно (API его не даёт), адреса нет.
  return { label: nick || "anon", kind: "anon", address: null };
}

export function buildLeaderboard(
  snapshot: PlayerSnapshot[],
  now: number,
  meIdentity: string,
  limit = 10,
): LeaderboardView {
  // Кошельки команды вырезаем ДО расчёта: иначе они занимали бы места в топ-10 и
  // попадали в счётчик игроков и в общий сейф.
  const excluded = parseExcluded(process.env.BOARD_EXCLUDE);
  // Имя `ranked`, а не `eligible`: «eligible» в этом файле теперь означает право на
  // ВЫПЛАТУ (подтверждённый кошелёк), и две разные проверки под одним именем читались бы
  // как одна.
  const ranked = snapshot.filter((p) => !isExcluded(p.identity, excluded));

  // Живой стек каждого через settle: он же переводит игрока на текущую неделю и
  // фиксирует базу `weekStartStack`, если игрок с прошлой недели ещё не заходил.
  const live = ranked.map((p) => {
    const state: PlayerState = settle(p.state, now).state;
    return {
      identity: p.identity,
      // Ранг — по приросту за неделю. max(0, …) страхует от отрицательного значения,
      // если стек уменьшился после базы (рейдер скимит долю накопленного).
      stack: Math.max(0, state.stack - state.weekStartStack),
      lifetimeStack: state.stack,
      streak: state.streak,
      display: displayFor(p.identity, state),
    };
  });

  live.sort((a, b) => b.stack - a.stack);

  // Общий сейф — сумма НАКОПЛЕННЫХ стеков, а не недельных: это витрина того, сколько
  // комьюнити настакало вообще, и обнулять её каждую субботу бессмысленно.
  const communalVault = live.reduce((sum, p) => sum + p.lifetimeStack, 0);

  // Призовые места раздаются сверху вниз по борду ВСЕМ, включая анонимов (правило
  // 2026-07-28): так процент на сайте становится буквально выплаченным процентом. Доля
  // места без кошелька не переходит соседям — она сгорает (lib/week-results.ts).
  // Нулевой прирост места не занимает: платить за неучастие не за что, иначе пустые
  // сессии добирали бы хвост десятки просто фактом существования.
  let seat = 0;
  const seated = live.map((p) => {
    const eligible = isPayoutEligible(p.identity);
    // Место занимает и аноним (правило 2026-07-28): его доля не переходит другим, а
    // сгорает. `eligible` отвечает только на вопрос «заплатят ли», а не «занял ли место».
    const inMoney = occupiesSeat(p.identity) && p.stack > 0 && seat < PAYOUT_SEATS;
    return { ...p, eligible, moneyRank: inMoney ? ++seat : null };
  });

  // Сколько строк показать. Если половину верхушки занимают сессии без кошелька, десятое
  // призовое место уезжает ниже десятой строки — борд, обрезанный по `limit`, показывал бы
  // «в деньгах» тех, кому не платят, и прятал тех, кому платят. Поэтому дотягиваем список
  // до последнего призового места, но не бесконечно: потолок — `limit + PAYOUT_SEATS`.
  let lastSeatIndex = -1;
  seated.forEach((p, i) => {
    if (p.moneyRank !== null) lastSeatIndex = i;
  });
  const rowCount = Math.min(
    Math.max(limit, lastSeatIndex + 1),
    limit + PAYOUT_SEATS,
  );

  const top: LeaderRow[] = seated.slice(0, rowCount).map((p, i) => ({
    rank: i + 1,
    label: p.display.label,
    kind: p.display.kind,
    address: p.display.address,
    stack: p.stack,
    lifetimeStack: p.lifetimeStack,
    streak: p.streak,
    isYou: p.identity === meIdentity,
    eligible: p.eligible,
    moneyRank: p.moneyRank,
  }));

  const myIndex = seated.findIndex((p) => p.identity === meIdentity);
  const you =
    myIndex >= 0
      ? {
          rank: myIndex + 1,
          stack: seated[myIndex].stack,
          eligible: seated[myIndex].eligible,
          moneyRank: seated[myIndex].moneyRank,
        }
      : null;

  return {
    communalVault,
    players: live.length,
    top,
    you,
    week: weekInfo(now),
    payoutSeats: PAYOUT_SEATS,
  };
}

/**
 * POST /api/admin/close-week — финализация завершённой недели.
 *
 * Что делает: собирает всех, кто закончил неделю `weekId`, проставляет места и доли пула
 * и сохраняет результат. После этого список победителей существует как факт в БД и больше
 * не зависит от того, что случится со стеками дальше.
 *
 * Зачем отдельный шаг, если `mutate` и так фиксирует неделю каждому переходящему игроку:
 * место — свойство ВСЕЙ таблицы, при закрытии игроков по одному оно неизвестно. Плюс тот,
 * кто после субботы не вернулся, свою неделю сам не закроет никогда — здесь он досчитывается
 * тем же `settle`, что и в игре.
 *
 * Денег роут НЕ отправляет и отправлять не будет: выплаты делаются руками (docs/security.md).
 * Он только готовит список — кому, сколько и по какому месту.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { settle } from "@/lib/game";
import { jsonNoStore, readJsonBody } from "@/lib/http";
import { parseExcluded } from "@/lib/leaderboard";
import { payoutSharePct } from "@/lib/payout";
import { getStore } from "@/lib/store";
import { weekInfo } from "@/lib/week";
import { addressOf, closedWeekOf, finalizeWeekWithShares } from "@/lib/week-results";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Доступ по общему секрету, а не по сессии: роут дёргает cron или человек из терминала,
 * браузерной сессии там нет. Сравнение — по хешам постоянной длины: прямое сравнение строк
 * выходит из цикла на первом несовпавшем символе и по времени ответа выдаёт секрет по байтам.
 *
 * Секрет короче 16 символов считаем незаданным: подобрать такой перебором дешевле, чем
 * ждать, пока кто-то заметит, что эндпоинт закрыт формально.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET ?? "";
  if (secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(token), h(secret));
}

export async function POST(req: NextRequest) {
  // Секрет не выставлен — отвечаем 503, а не «ок, но ничего не делаем»: молчаливо
  // неработающая финализация обнаружилась бы в субботу вечером, когда платить уже пора.
  if ((process.env.ADMIN_SECRET ?? "").length < 16) {
    return jsonNoStore({ error: "admin_secret_missing" }, { status: 503 });
  }
  if (!authorized(req)) return jsonNoStore({ error: "unauthorized" }, { status: 401 });

  const body = await readJsonBody(req);
  if (!body.ok) return jsonNoStore({ error: body.error }, { status: 400 });
  const dryRun = body.value.dryRun === true;

  const now = Date.now();
  const current = weekInfo(now);
  const weekId =
    typeof body.value.weekId === "number"
      ? Math.trunc(body.value.weekId)
      : current.weekId - 1;

  // Текущую неделю закрывать нельзя: она ещё идёт, и зафиксированные места разошлись бы
  // с итоговыми — а объявленный список победителей отозвать уже невозможно.
  if (weekId >= current.weekId) {
    return jsonNoStore(
      { error: "week_not_finished", weekId, currentWeekId: current.weekId },
      { status: 400 },
    );
  }

  const store = await getStore();
  const excluded = parseExcluded(process.env.BOARD_EXCLUDE);
  const isTeam = (identity: string) => {
    const a = addressOf(identity);
    return a !== null && excluded.has(a);
  };

  // Собираем участников недели из двух источников. Ключ — identity, поэтому пересечение
  // источников не задваивает игрока.
  const entries = new Map<string, number>();

  // 1. Те, кто уже перешёл на новую неделю: их результат зафиксирован в момент перехода
  //    (store.mutate → closedWeekOf) и в стейте больше не выводится.
  for (const r of await store.weekResults(weekId)) {
    if (!isTeam(r.identity)) entries.set(r.identity, r.gain);
  }

  // 2. Те, кто с прошлой недели не заходил: досчитываем тем же `settle`, что и в игре —
  //    он докрутит машину ровно до субботней полуночи и вернёт прирост закрытой недели.
  //    Стейт при этом НЕ персистим: задача роута — зафиксировать результат недели, а не
  //    трогать игроков.
  for (const p of await store.snapshot()) {
    if (p.state.weekId !== weekId || isTeam(p.identity)) continue;
    const closed = closedWeekOf(p.state, settle(p.state, now).state);
    if (closed && closed.weekId === weekId) entries.set(p.identity, closed.gain);
  }

  const records = finalizeWeekWithShares(
    weekId,
    [...entries].map(([identity, gain]) => ({ identity, gain })),
    excluded,
  );

  if (!dryRun) await store.saveWeekResults(records);

  const paid = records.filter((r) => r.rank !== null);
  return jsonNoStore({
    ok: true,
    dryRun,
    weekId,
    participants: records.length,
    seats: paid.length,
    // Наружу — только адреса: internal id не отдаём даже админскому клиенту, чтобы
    // формат идентичности не расползался по скриптам и логам.
    payouts: paid.map((r) => ({
      rank: r.rank,
      address: r.address,
      gain: Math.floor(r.gain),
      share: r.share,
      sharePct: payoutSharePct(r.rank!, paid.length),
    })),
    // Сколько игроков осталось без выплаты только из-за отсутствия кошелька — это метрика
    // для community-работы: столько людей играли, но получить ничего не могут.
    notEligible: records.filter((r) => !r.eligible && r.gain > 0).length,
  });
}

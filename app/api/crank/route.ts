/**
 * POST /api/crank — единственный способ завести машину. Вся валидация на сервере:
 * settle → проверка фазы (winding отклоняется) → рост/сброс стрика → персист.
 * Клиент НЕ может ускорить время или начислить стек в обход этой логики.
 */
import { NextRequest } from "next/server";
import { crank, phase, settle, toPublicView, type HolderRead } from "@/lib/game";
import { getStore } from "@/lib/store";
import { jsonNoStore, resolveIdentity, sameOriginOk } from "@/lib/http";
import { allowCrank } from "@/lib/ratelimit";
import { addressFromIdentity } from "@/lib/auth";
import { computeHolderBoost } from "@/lib/vltr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Кранк меняет стейт и влияет на позицию в борде, который делит реальные токены:
  // чужая страница не должна дёргать его за игрока (например, чтобы сбить ему тайминг).
  if (!sameOriginOk(req)) {
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }

  const identity = await resolveIdentity(req);
  const now = Date.now();

  if (!(await allowCrank(identity, now))) {
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const store = await getStore();

  // Тир холда перечитываем ИМЕННО на кранке: он фиксирует ставку на следующие 24 часа.
  // Раньше буст писался только при логине — холдер мог войти с токеном, тут же продать
  // его и стакать с множителем бесконечно, забирая призовой пул, ничего не холдя.
  //
  // Но не на КАЖДОЙ попытке: во время завода кранк отклоняется, а RPC-чтение при лимите
  // 1/сек дало бы до 86 400 запросов в сутки на игрока. Поэтому сначала дешёвое чтение
  // стейта, и в сеть идём, только если кранк вообще может пройти.
  // Гонка тут безопасна: фазу заново проверяет crank() внутри транзакции, а если тир
  // мы не читали, он остаётся прежним (undefined → не трогаем).
  const address = addressFromIdentity(identity);
  let freshHolder: HolderRead | null | undefined;
  if (address) {
    const stored = await store.read(identity, now);
    if (phase(settle(stored, now).state, now) !== "winding") {
      // null (RPC не ответил) → crank оставит прежний тир, а не снимет буст.
      freshHolder = await computeHolderBoost(address, now);
    }
  } else {
    freshHolder = { tier: 0, ppb: 0 }; // анонимная сессия — буста нет по определению
  }

  const { state, result } = await store.mutate(
    identity,
    now,
    (s) => {
      const cr = crank(s, now, freshHolder);
      return { state: cr.state, result: cr };
    },
    // Журналим только успешные кранки: отклонённые стейт не меняют (спорить не о чем),
    // а поллящий клиент нагенерил бы гору строк. Пишется в той же транзакции.
    ({ result: cr, state: after }) =>
      cr.ok
        ? {
            at: now,
            ok: true,
            phase: cr.phaseAt,
            streak: after.streak,
            stack: after.stack,
            lostToRaid: cr.raid?.lost ?? null,
          }
        : null,
  );

  return jsonNoStore({
    ok: result.ok,
    reason: result.reason ?? null,
    raid: result.raid,
    view: toPublicView(state, now),
  });
}

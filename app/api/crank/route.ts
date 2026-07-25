/**
 * POST /api/crank — единственный способ завести машину. Вся валидация на сервере:
 * settle → проверка фазы (winding отклоняется) → рост/сброс стрика → персист.
 * Клиент НЕ может ускорить время или начислить стек в обход этой логики.
 */
import { NextRequest, NextResponse } from "next/server";
import { crank, toPublicView } from "@/lib/game";
import { getStore } from "@/lib/store";
import { resolveIdentity } from "@/lib/http";
import { allowCrank } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const now = Date.now();

  if (!(await allowCrank(identity, now))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const store = await getStore();
  const { state, result } = await store.mutate(
    identity,
    now,
    (s) => {
      const cr = crank(s, now);
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

  return NextResponse.json({
    ok: result.ok,
    reason: result.reason ?? null,
    raid: result.raid,
    view: toPublicView(state, now),
  });
}

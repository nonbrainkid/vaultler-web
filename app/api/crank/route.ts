/**
 * POST /api/crank — единственный способ завести машину. Вся валидация на сервере:
 * settle → проверка фазы (winding отклоняется) → рост/сброс стрика → персист.
 * Клиент НЕ может ускорить время или начислить стек в обход этой логики.
 */
import { NextRequest, NextResponse } from "next/server";
import { crank, toPublicView } from "@/lib/game";
import { getStore } from "@/lib/store";
import { attachSession, resolveIdentity } from "@/lib/http";
import { allowCrank } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const r = resolveIdentity(req);
  const now = Date.now();

  if (!allowCrank(r.identity, now)) {
    return attachSession(
      NextResponse.json({ error: "rate_limited" }, { status: 429 }),
      r,
    );
  }

  const store = await getStore();
  const { state, result } = await store.mutate(r.identity, now, (s) => {
    const cr = crank(s, now);
    return { state: cr.state, result: cr };
  });

  const res = NextResponse.json({
    ok: result.ok,
    reason: result.reason ?? null,
    raid: result.raid,
    view: toPublicView(state, now),
  });
  return attachSession(res, r);
}

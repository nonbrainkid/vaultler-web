/**
 * POST /api/boost/refresh — перечитать баланс $VLTR и обновить буст для текущего кошелька.
 * Для анонимной сессии — no-op. Чтение баланса делает сервер (клиент буст не задаёт).
 */
import { NextRequest, NextResponse } from "next/server";
import { addressFromIdentity } from "@/lib/auth";
import { computeBoost } from "@/lib/vltr";
import { getStore } from "@/lib/store";
import { settle, toPublicView } from "@/lib/game";
import { resolveIdentity } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const address = addressFromIdentity(identity);
  const now = Date.now();

  if (!address) {
    // анонимная сессия — буста нет
    const store = await getStore();
    const stored = await store.read(identity, now);
    return NextResponse.json({ boost: false, view: toPublicView(settle(stored, now).state, now) });
  }

  // null — RPC не ответил. Прежний буст СОХРАНЯЕМ: снимать ×5 у холдера из-за сетевого
  // сбоя нельзя (а выдавать незаслуженно — тем более).
  const fresh = await computeBoost(address);
  const store = await getStore();
  const { state } = await store.mutate(identity, now, (s) => {
    const r = settle(s, now);
    if (fresh !== null) r.state.boost = fresh;
    return { state: r.state, result: r };
  });

  return NextResponse.json({
    boost: state.boost,
    // Честно сообщаем клиенту, что значение не подтверждено: UI не должен показывать
    // «не холдит», когда мы просто не смогли посмотреть.
    stale: fresh === null,
    view: toPublicView(state, now),
  });
}

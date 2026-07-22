/**
 * GET /api/state — текущий стейт игрока для отрисовки.
 * Read-only: settle считается в памяти только для отображения и НЕ персистится
 * (стек детерминирован из таймстемпов; запись происходит на кранке). Так поллинг дешёвый.
 */
import { NextRequest, NextResponse } from "next/server";
import { settle, toPublicView } from "@/lib/game";
import { getStore } from "@/lib/store";
import { attachSession, resolveIdentity } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const r = resolveIdentity(req);
  const now = Date.now();

  const store = await getStore();
  const stored = await store.read(r.identity, now);
  const settled = settle(stored, now); // только для отображения, без записи

  const res = NextResponse.json({
    view: toPublicView(settled.state, now),
    raid: settled.raid, // если игрок как раз простоял окно — покажем рейд
  });
  return attachSession(res, r);
}

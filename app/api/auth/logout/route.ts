/**
 * POST /api/auth/logout — выйти из кошелька: гасим session-cookie.
 * На следующем запросе proxy заведёт свежую анонимную dev-сессию (играть можно и без кошелька).
 */
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

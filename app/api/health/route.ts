/**
 * GET /api/health — лёгкий health-check для мониторинга/uptime и проверки после деплоя.
 * Проверяет, что стор отвечает. Секретов и приватных данных не отдаёт.
 */
import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  let ok = true;

  try {
    const store = await getStore();
    await store.snapshot();
    checks.store = process.env.DATABASE_URL ? "postgres" : "file";
  } catch {
    ok = false;
    checks.store = "error";
  }

  checks.sessionSecret = process.env.SESSION_SECRET ? "set" : "default";
  checks.chain = process.env.NEXT_PUBLIC_RH_RPC_URL ? "configured" : "placeholder";

  return NextResponse.json({ ok, checks, ts: Date.now() }, { status: ok ? 200 : 503 });
}

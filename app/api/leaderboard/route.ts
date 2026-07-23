/**
 * GET /api/leaderboard — недельный лидерборд + общий сейф.
 * Ранги и «общий сейф» считает сервер по живому стеку (settle каждому).
 */
import { NextRequest, NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { resolveIdentity } from "@/lib/http";
import { buildLeaderboard } from "@/lib/leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const now = Date.now();
  const store = await getStore();
  const snapshot = await store.snapshot();
  return NextResponse.json(buildLeaderboard(snapshot, now, identity, 10));
}

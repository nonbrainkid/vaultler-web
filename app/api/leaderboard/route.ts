/**
 * GET /api/leaderboard — недельный лидерборд + общий сейф.
 * Ранги и «общий сейф» считает сервер по живому стеку (settle каждому).
 */
import { NextRequest } from "next/server";
import { getStore } from "@/lib/store";
import { jsonNoStore, resolveIdentity } from "@/lib/http";
import { buildLeaderboard } from "@/lib/leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const now = Date.now();
  const store = await getStore();
  const snapshot = await store.snapshot();
  // Борд персонализирован (isYou, своя позиция) — общий кэш отдал бы чужую разметку.
  return jsonNoStore(buildLeaderboard(snapshot, now, identity, 10));
}

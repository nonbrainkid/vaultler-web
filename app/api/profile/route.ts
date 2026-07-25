/**
 * POST /api/profile — задать ник и приватность адреса. Только для сессии с кошельком
 * (у анонимов личность = кука, легко сбросить → сквот ников). Ник уникален глобально.
 */
import { NextRequest, NextResponse } from "next/server";
import { resolveIdentity } from "@/lib/http";
import { addressFromIdentity } from "@/lib/auth";
import { validateNickname } from "@/lib/profile";
import { getStore } from "@/lib/store";
import { toPublicView } from "@/lib/game";
import { allowProfile, clientKey } from "@/lib/ratelimit";
import type { ProfilePatch } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await allowProfile(clientKey(req), Date.now()))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const identity = await resolveIdentity(req);
  if (!addressFromIdentity(identity)) {
    // анонимная сессия — ник нельзя (нужен подтверждённый кошелёк)
    return NextResponse.json({ error: "wallet_required" }, { status: 403 });
  }

  let body: { nickname?: unknown; hideWallet?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }

  const patch: ProfilePatch = {};

  if (body.nickname !== undefined) {
    if (body.nickname === null || body.nickname === "") {
      patch.nickname = null; // очистить
    } else {
      const check = validateNickname(body.nickname);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
      patch.nickname = check.value!;
    }
  }
  if (typeof body.hideWallet === "boolean") {
    patch.hideWallet = body.hideWallet;
  }

  if (patch.nickname === undefined && patch.hideWallet === undefined) {
    return NextResponse.json({ error: "nothing_to_update" }, { status: 400 });
  }

  const now = Date.now();
  const store = await getStore();
  const result = await store.setProfile(identity, now, patch);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    nickname: result.state.nickname,
    hideWallet: result.state.hideWallet,
    view: toPublicView(result.state, now),
  });
}

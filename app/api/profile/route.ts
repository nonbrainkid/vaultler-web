/**
 * POST /api/profile — задать ник и приватность адреса. Только для сессии с кошельком
 * (у анонимов личность = кука, легко сбросить → сквот ников). Ник уникален глобально.
 */
import { NextRequest } from "next/server";
import { jsonNoStore, readJsonBody, resolveIdentity, sameOriginOk } from "@/lib/http";
import { addressFromIdentity } from "@/lib/auth";
import { validateNickname } from "@/lib/profile";
import { getStore } from "@/lib/store";
import { toPublicView } from "@/lib/game";
import { allowProfile, clientKey } from "@/lib/ratelimit";
import type { ProfilePatch } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Без этой проверки чужая страница могла бы молча переименовать игрока на борде
  // или раскрыть его адрес, сняв hideWallet, — cookie браузер приложил бы сам.
  if (!sameOriginOk(req)) {
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }

  const identity = await resolveIdentity(req);
  if (!(await allowProfile(clientKey(req, identity), Date.now()))) {
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  if (!addressFromIdentity(identity)) {
    // анонимная сессия — ник нельзя (нужен подтверждённый кошелёк)
    return jsonNoStore({ error: "wallet_required" }, { status: 403 });
  }

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) {
    return jsonNoStore(
      { error: parsedBody.error },
      { status: parsedBody.error === "too_large" ? 413 : 400 },
    );
  }
  const body = parsedBody.value as { nickname?: unknown; hideWallet?: unknown };

  const patch: ProfilePatch = {};

  if (body.nickname !== undefined) {
    if (body.nickname === null || body.nickname === "") {
      patch.nickname = null; // очистить
    } else {
      const check = validateNickname(body.nickname);
      if (!check.ok) return jsonNoStore({ error: check.error }, { status: 400 });
      patch.nickname = check.value!;
    }
  }
  if (typeof body.hideWallet === "boolean") {
    patch.hideWallet = body.hideWallet;
  }

  if (patch.nickname === undefined && patch.hideWallet === undefined) {
    return jsonNoStore({ error: "nothing_to_update" }, { status: 400 });
  }

  const now = Date.now();
  const store = await getStore();
  const result = await store.setProfile(identity, now, patch);

  if (!result.ok) {
    return jsonNoStore({ error: result.error }, { status: 409 });
  }

  return jsonNoStore({
    ok: true,
    nickname: result.state.nickname,
    hideWallet: result.state.hideWallet,
    view: toPublicView(result.state, now),
  });
}

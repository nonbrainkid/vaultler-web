/**
 * POST /api/auth/verify — проверить подпись кошелька и сделать адрес идентичностью игрока.
 *
 * Безопасность: подпись доказывает владение кошельком (один кошелёк = один аккаунт).
 * Буст ×1.5 сервер вычисляет сам, читая баланс $VLTR on-chain — клиент не может его наврать.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyMessage, isAddress } from "viem";
import { NONCE_COOKIE, buildAuthMessage, walletIdentity } from "@/lib/auth";
import { SESSION_COOKIE, signedCookieValue } from "@/lib/session";
import { computeBoost } from "@/lib/vltr";
import { getStore } from "@/lib/store";
import { settle, toPublicView } from "@/lib/game";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { address?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { address, signature } = body;
  if (!address || !isAddress(address) || !signature) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  const nonce = req.cookies.get(NONCE_COOKIE)?.value;
  if (!nonce) {
    return NextResponse.json({ error: "nonce_missing" }, { status: 400 });
  }

  const message = buildAuthMessage(address, nonce);
  let valid = false;
  try {
    valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    valid = false;
  }
  if (!valid) {
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const identity = walletIdentity(address);
  const now = Date.now();
  const boost = await computeBoost(address); // серверное чтение on-chain

  const store = await getStore();
  const { state } = await store.mutate(identity, now, (s) => {
    const r = settle(s, now);
    r.state.boost = boost; // буст применяется дальше по времени
    return { state: r.state, result: r };
  });

  const res = NextResponse.json({
    ok: true,
    identity,
    view: toPublicView(state, now),
  });
  res.cookies.set(SESSION_COOKIE, await signedCookieValue(identity), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 }); // одноразовый — гасим
  return res;
}

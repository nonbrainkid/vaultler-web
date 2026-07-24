/**
 * GET /api/auth/nonce — выдать одноразовый nonce для входа кошельком (SIWE).
 * Nonce кладём в httpOnly-cookie: старую подпись переиспользовать нельзя (nonce одноразовый,
 * стирается при verify), а сам nonce клиенту не подделать в обход cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { NONCE_COOKIE, SIWE_TTL_MS } from "@/lib/auth";
import { allowNonce, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!allowNonce(clientKey(req), Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const nonce = generateSiweNonce(); // криптостойкий алфанумерик, ≥8 симв.
  const res = NextResponse.json({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.ceil(SIWE_TTL_MS / 1000),
  });
  return res;
}

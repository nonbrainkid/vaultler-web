/**
 * GET /api/auth/nonce — выдать одноразовый nonce для входа кошельком.
 * Nonce кладём в httpOnly-cookie (анти-replay: старую подпись переиспользовать нельзя,
 * nonce одноразовый и стирается при verify).
 */
import { NextResponse } from "next/server";
import { NONCE_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const nonce = crypto.randomUUID();
  const res = NextResponse.json({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 300, // 5 минут на подпись
  });
  return res;
}

/**
 * GET /api/auth/nonce — выдать одноразовый nonce для входа кошельком (SIWE).
 * Nonce кладём в httpOnly-cookie: старую подпись переиспользовать нельзя (nonce одноразовый,
 * стирается при verify), а сам nonce клиенту не подделать в обход cookie.
 */
import { NextRequest } from "next/server";
import { generateSiweNonce } from "viem/siwe";
import { NONCE_COOKIE, SIWE_TTL_MS } from "@/lib/auth";
import { allowNonce, clientKey } from "@/lib/ratelimit";
import { jsonNoStore, resolveIdentity } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Ключ лимита: доверенный IP, а если его неоткуда взять — сессия (см. lib/ratelimit.ts).
  const key = clientKey(req, await resolveIdentity(req));
  if (!(await allowNonce(key, Date.now()))) {
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const nonce = generateSiweNonce(); // криптостойкий алфанумерик, ≥8 симв.
  // Ответ несёт Set-Cookie с одноразовым nonce: закэшируйся он в общем кэше — двое
  // разных пользователей получили бы один и тот же nonce, и «одноразовость» исчезла бы.
  const res = jsonNoStore({ nonce });
  res.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.ceil(SIWE_TTL_MS / 1000),
  });
  return res;
}

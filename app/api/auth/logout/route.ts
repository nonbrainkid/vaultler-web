/**
 * POST /api/auth/logout — выйти из кошелька: гасим session-cookie.
 * На следующем запросе proxy заведёт свежую анонимную dev-сессию (играть можно и без кошелька).
 */
import { NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";
import { NONCE_COOKIE } from "@/lib/auth";
import { jsonNoStore, sameOriginOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  // Выход — тоже мутация: чужая страница не должна разлогинивать игрока в один клик.
  if (!sameOriginOk(req)) {
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }

  const res = jsonNoStore({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  // Заодно гасим незакрытый nonce: висящий одноразовый код после выхода не нужен никому.
  res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

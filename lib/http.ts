/**
 * Резолв идентичности игрока в API-роутах.
 * Middleware гарантированно проставляет заголовок x-vaultler-id (см. middleware.ts),
 * поэтому роуту достаточно прочитать его. Cookie-фолбэк — на случай прямого доступа
 * к /api в обход middleware (тогда идентичность берётся из подписанной cookie).
 */
import { NextRequest } from "next/server";
import { SESSION_COOKIE, identityFromCookie, newIdentity } from "./session";

export async function resolveIdentity(req: NextRequest): Promise<string> {
  const fromHeader = req.headers.get("x-vaultler-id");
  if (fromHeader) return fromHeader;

  const fromCookie = await identityFromCookie(req.cookies.get(SESSION_COOKIE)?.value);
  if (fromCookie) return fromCookie;

  // Крайний случай: ни middleware, ни cookie. Возвращаем свежий id (эфемерный).
  return newIdentity();
}

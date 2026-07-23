/**
 * Next proxy (бывш. middleware). Устанавливает сессию игрока на загрузке страницы
 * (навигационный ответ), а не через fetch — так cookie надёжно сохраняется во всех
 * браузерах и нет гонки двойного минта в dev.
 *
 * Идентичность (существующая из cookie или свежая) прокидывается в роут заголовком
 * x-vaultler-id, чтобы роут и proxy гарантированно видели один и тот же id.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  identityFromCookie,
  newIdentity,
  signedCookieValue,
} from "@/lib/session";

export async function proxy(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  let id = await identityFromCookie(raw);
  const mint = id === null;
  if (id === null) id = newIdentity();

  const headers = new Headers(req.headers);
  headers.set("x-vaultler-id", id);

  const res = NextResponse.next({ request: { headers } });
  if (mint) {
    res.cookies.set(SESSION_COOKIE, await signedCookieValue(id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export const config = {
  // Исключаем статику Next; на страницы и /api middleware работает.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

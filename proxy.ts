/**
 * Next proxy (бывш. middleware). Делает две вещи на каждом навигационном запросе:
 *
 * 1) Сессия игрока. Ставит cookie на навигационном ответе (а не через fetch) — так cookie
 *    надёжно сохраняется во всех браузерах и нет гонки двойного минта в dev. Идентичность
 *    прокидывается в роут заголовком x-vaultler-id.
 *
 * 2) Content-Security-Policy с nonce (прод). Главный барьер против внедрения чужого
 *    (дрейнер-)скрипта через XSS: разрешаем выполнять только наши скрипты с одноразовым
 *    nonce, никакого inline/eval. В dev CSP ослаблен — Turbopack HMR требует eval/inline.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  identityFromCookie,
  newIdentity,
  signedCookieValue,
} from "@/lib/session";

const isProd = process.env.NODE_ENV === "production";

function makeNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function cspHeader(nonce: string): string {
  const script = isProd
    ? `'self' 'nonce-${nonce}' 'strict-dynamic'`
    : `'self' 'unsafe-inline' 'unsafe-eval'`; // dev: HMR
  return [
    `default-src 'self'`,
    `script-src ${script}`,
    // стили инлайнятся Next-ом; инъекция стилей — не вектор дрейна
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    // кошелёк + RPC (https/wss). Скрипт всё равно не выполнится без nonce, так что ок
    `connect-src 'self' https: wss:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'self'`,
    ...(isProd ? [`upgrade-insecure-requests`] : []),
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  let id = await identityFromCookie(raw);
  const mint = id === null;
  if (id === null) id = newIdentity();

  const nonce = makeNonce();
  const csp = cspHeader(nonce);

  // Прокидываем в приложение: идентичность игрока + nonce (Next применит его к своим скриптам).
  const headers = new Headers(req.headers);
  headers.set("x-vaultler-id", id);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);

  if (mint) {
    res.cookies.set(SESSION_COOKIE, await signedCookieValue(id), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProd,
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return res;
}

export const config = {
  // Исключаем статику Next; на страницы и /api proxy работает.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

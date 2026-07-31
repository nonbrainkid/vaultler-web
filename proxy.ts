/**
 * Next proxy (бывш. middleware). Делает три вещи на каждом запросе:
 *
 * 1) Сессия игрока. Ставит cookie на навигационном ответе (а не через fetch) — так cookie
 *    надёжно сохраняется во всех браузерах и нет гонки двойного минта в dev. Идентичность
 *    прокидывается в роут заголовком x-vaultler-id — ПОДПИСАННОЙ (см. ниже).
 *
 * 2) Content-Security-Policy с nonce (прод). Главный барьер против внедрения чужого
 *    (дрейнер-)скрипта через XSS: разрешаем выполнять только наши скрипты с одноразовым
 *    nonce, никакого inline/eval. В dev CSP ослаблен — Turbopack HMR требует eval/inline.
 *
 * 3) Запрет кэширования всего, что персонально. Ответ несёт Set-Cookie с сессией и
 *    личные данные игрока: если такой ответ осядет в общем кэше (CDN, корпоративный
 *    прокси), другой пользователь получит ЧУЖУЮ сессионную cookie — то есть чужой
 *    аккаунт. Заголовок no-store закрывает это на уровне всех промежуточных кэшей.
 *
 * Почему заголовок с идентичностью подписан, хотя мы его тут же и ставим:
 * `headers.set` перезаписывает клиентский заголовок, поэтому подделка сегодня не проходит
 * (проверено). Но это единственный барьер, а стоит он на предположении «proxy отработал».
 * Предположение ломается от изменения matcher, от бага обхода middleware во фреймворке
 * (такие уже были — CVE-2025-29927) и при вызове роута в обход proxy на самохостинге.
 * Ценой одной строки роут теперь проверяет HMAC сам: подделать заголовок нельзя, не зная
 * SESSION_SECRET. Документация Next прямо предупреждает, что proxy — не механизм авторизации.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_REFRESH_AFTER_MS,
  SESSION_TTL_MS,
  newIdentity,
  readSignedIdentity,
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
    /**
     * Service worker для веб-пушей (`/sw.js`) — ЯВНО, а не по фолбэку.
     *
     * Без этой строки `worker-src` наследуется от `script-src`, где стоит `strict-dynamic`,
     * а `strict-dynamic` заставляет браузер игнорировать `'self'` и разрешать только
     * скрипты, добавленные доверенным скриптом. Регистрация воркера под это правило не
     * попадает — она блокируется, и в проде (где CSP строгий) напоминания молча не
     * включались бы, работая при этом в dev. Один явный источник закрывает вопрос:
     * воркер разрешён только со своего origin.
     */
    `worker-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `frame-src 'self'`,
    ...(isProd ? [`upgrade-insecure-requests`] : []),
  ].join("; ");
}

export async function proxy(req: NextRequest) {
  const now = Date.now();
  const session = await readSignedIdentity(req.cookies.get(SESSION_COOKIE)?.value, now);

  // Продлеваем скользящим окном: активный игрок не разлогинится на 30-й день,
  // а брошенная сессия всё равно протухнет по TTL.
  const stale = session !== null && now - session.issuedAt > SESSION_REFRESH_AFTER_MS;
  const id = session === null ? newIdentity() : session.id;
  const issuedAt = session === null || stale ? now : session.issuedAt;
  const setCookie = session === null || stale;

  const signed = await signedCookieValue(id, issuedAt);

  const nonce = makeNonce();
  const csp = cspHeader(nonce);

  // Прокидываем в приложение: подписанная идентичность + nonce (Next применит его к своим
  // скриптам). `set`, а не `append` — клиентские одноимённые заголовки затираются.
  const headers = new Headers(req.headers);
  headers.set("x-vaultler-id", signed);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const res = NextResponse.next({ request: { headers } });
  res.headers.set("content-security-policy", csp);

  // Персональный ответ не должен осесть ни в одном кэше. Особенно тот, что несёт
  // Set-Cookie с сессией: отданная из кэша чужая cookie = отданный чужой аккаунт.
  if (setCookie || req.nextUrl.pathname.startsWith("/api/")) {
    res.headers.set("cache-control", "private, no-store, max-age=0, must-revalidate");
  }

  if (setCookie) {
    res.cookies.set(SESSION_COOKIE, signed, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: isProd,
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
  }
  return res;
}

export const config = {
  // Исключаем статику Next; на страницы и /api proxy работает.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

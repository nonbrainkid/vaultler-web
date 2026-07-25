/**
 * Общая обвязка API-роутов: идентичность, запрет кэша, защита от CSRF, лимит тела.
 * Роуты остаются тонкими, а правила безопасности живут в одном месте и покрыты тестами.
 */
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, identityFromCookie, newIdentity } from "./session";

/**
 * Резолв идентичности игрока.
 *
 * Заголовок `x-vaultler-id` ставит proxy.ts, и он же затирает клиентский одноимённый.
 * Но роут ему НЕ доверяет на слово: значение подписано HMAC (lib/session.ts) и здесь
 * проверяется заново.
 *
 * Зачем, если proxy и так затирает: доверие к заголовку держалось на предположении,
 * что proxy отработал. Предположение ломается при изменении matcher, при баге обхода
 * middleware во фреймворке (CVE-2025-29927 отключал middleware одним заголовком) и при
 * прямом вызове роута на самохостинге. Цена ошибки — полный захват любого аккаунта
 * одним `curl -H "x-vaultler-id: wallet:0x…"`, включая кошельки из топа борда, который
 * делит реальные токены. Теперь подделка требует SESSION_SECRET.
 */
export async function resolveIdentity(req: NextRequest): Promise<string> {
  const now = Date.now();

  const fromHeader = await identityFromCookie(req.headers.get("x-vaultler-id"), now);
  if (fromHeader) return fromHeader;

  // Фолбэк: прямой доступ к /api в обход proxy — идентичность из подписанной cookie.
  const fromCookie = await identityFromCookie(req.cookies.get(SESSION_COOKIE)?.value, now);
  if (fromCookie) return fromCookie;

  // Крайний случай: ни proxy, ни cookie. Возвращаем свежий id (эфемерный).
  return newIdentity();
}

/**
 * Пометить ответ как персональный и некэшируемый.
 *
 * Ответы API несут адрес кошелька, ник, настройку приватности и Set-Cookie с сессией.
 * Без явного запрета такой ответ может осесть в общем кэше (CDN, корпоративный прокси,
 * ошибочный s-maxage), и следующий пользователь получит чужие данные — а вместе с
 * Set-Cookie и чужой аккаунт. `force-dynamic` управляет кэшем Next, но не чужими кэшами
 * по дороге; заголовок нужен явный.
 */
export function noStore<T extends NextResponse>(res: T): T {
  res.headers.set("cache-control", "private, no-store, max-age=0, must-revalidate");
  res.headers.append("vary", "cookie");
  return res;
}

/** JSON-ответ, который заведомо не попадёт ни в один кэш. */
export function jsonNoStore(
  body: unknown,
  init?: { status?: number },
): NextResponse {
  return noStore(NextResponse.json(body, init));
}

/**
 * Проверка происхождения запроса (анти-CSRF).
 *
 * Основной барьер — `SameSite=lax` на сессионной cookie: браузер не приложит её к
 * кросс-сайтовому POST. Это второй слой на случай, если cookie однажды понадобится
 * ослабить до `none` (встроенные браузеры кошельков), или если браузер поведёт себя
 * иначе. Атака, которую закрываем: страница злоумышленника молча шлёт POST /api/profile
 * с cookie жертвы и переименовывает её на борде (или дёргает кранк в неудобный момент).
 *
 * Запросы без Origin (curl, серверные e2e-скрипты) пропускаем: браузер к кросс-сайтовому
 * запросу Origin приложит всегда, а не-браузерному клиенту cookie жертвы взять неоткуда.
 */
export function sameOriginOk(req: NextRequest): boolean {
  // Современные браузеры сообщают контекст напрямую — самый надёжный сигнал.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;

  const origin = req.headers.get("origin");
  if (!origin) return true;

  const expected = process.env.AUTH_DOMAIN || req.headers.get("host");
  if (!expected) return false;
  try {
    return new URL(origin).host === expected;
  } catch {
    return false;
  }
}

/** Максимум, который мы вообще готовы прочитать из тела POST-запроса. */
const MAX_BODY_BYTES = 16 * 1024;

export type BodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: "too_large" | "bad_body" };

/**
 * Прочитать JSON-тело с потолком по размеру.
 * Без потолка роут разбирает всё, что прислали: мегабайтный JSON тратит CPU инстанса
 * и обходится атакующему в один запрос (дешёвая асимметрия для отказа в обслуживании).
 */
export async function readJsonBody(req: NextRequest): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return { ok: false, error: "too_large" };
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, error: "bad_body" };
  }
  // content-length можно не прислать или соврать — проверяем и фактический размер.
  if (raw.length > MAX_BODY_BYTES) return { ok: false, error: "too_large" };

  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "bad_body" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "bad_body" };
  }
}

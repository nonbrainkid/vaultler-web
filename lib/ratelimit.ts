/**
 * Простые in-memory rate-limit'ы (анти-спам эндпоинтов).
 * Для прода нужен общий стор (Redis/Upstash) — память процесса не шарится между
 * инстансами (см. NOTES.md). На M-этапе достаточно как первый барьер.
 */

const MIN_INTERVAL_MS = 1000;
const lastCrank = new Map<string, number>();

export function allowCrank(identity: string, now: number): boolean {
  const prev = lastCrank.get(identity) ?? 0;
  if (now - prev < MIN_INTERVAL_MS) return false;
  lastCrank.set(identity, now);
  return true;
}

/** Скользящее окно: не более `limit` событий по ключу за `windowMs`. */
function slidingLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now: number): boolean => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= limit) {
      hits.set(key, arr);
      return false;
    }
    arr.push(now);
    hits.set(key, arr);
    // не даём мапе пухнуть без границ
    if (hits.size > 5000) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    }
    return true;
  };
}

// Вход кошельком. Подпись не брутфорсится (нужен приватник), лимит — анти-флуд.
// 30/мин на IP: с запасом для легитимного юзера (nonce+verify+повторы), но режет спам.
export const allowAuth = slidingLimiter(30, 60_000);
export const allowNonce = slidingLimiter(40, 60_000);
// Смена ника/приватности — свой бюджет, чтобы не конкурировал с логином.
export const allowProfile = slidingLimiter(30, 60_000);

/** Ключ клиента для rate-limit: первый IP из X-Forwarded-For (Vercel) либо fallback. */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

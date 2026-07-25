/**
 * GET /api/health — лёгкий health-check для мониторинга/uptime и проверки после деплоя.
 * Проверяет, что стор отвечает. Секретов и приватных данных не отдаёт.
 */
import { getStore } from "@/lib/store";
import { clientIpSource, rateLimitBackend } from "@/lib/ratelimit";
import { jsonNoStore } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const checks: Record<string, string> = {};
  let ok = true;

  try {
    const store = await getStore();
    await store.snapshot();
    checks.store = process.env.DATABASE_URL ? "postgres" : "file";
  } catch {
    ok = false;
    checks.store = "error";
  }

  checks.sessionSecret = process.env.SESSION_SECRET ? "set" : "default";
  checks.chain = process.env.NEXT_PUBLIC_RH_RPC_URL ? "configured" : "placeholder";
  // Домен для проверки SIWE-подписи. "host" в проде — дыра: подпись сверяется с тем,
  // что прислал сам запрос (см. lib/auth.ts). Роут входа в этом случае отвечает 500.
  checks.authDomain = process.env.AUTH_DOMAIN ? "pinned" : "host";
  // "memory" — лимиты считаются каждым инстансом отдельно и обходятся размазыванием
  // запросов. Перед раздачей реальных призов здесь должно быть "shared".
  checks.rateLimit = rateLimitBackend();
  // "session" в проде = перед приложением нет прокси, проставляющего доверенный IP:
  // лимиты держатся на cookie, которую атакующий ротирует бесплатно.
  checks.clientIp = clientIpSource(req);

  return jsonNoStore({ ok, checks, ts: Date.now() }, { status: ok ? 200 : 503 });
}

/**
 * GET/POST /api/push/subscribe — статус веб-пушей и сохранение подписки браузера.
 *
 * GET отдаёт публичный ключ VAPID (он публичен по своей природе — браузеру он нужен как
 * `applicationServerKey`) и число подписок ТЕКУЩЕЙ сессии. Сами endpoint'ы наружу не идут:
 * это capability-ссылки, и в ответе API им не место — клиент свою и так знает от браузера.
 *
 * POST принимает подписку. Идентичность берётся из `resolveIdentity()` (инвариант 6) — ни
 * одно поле тела на идентичность не влияет, иначе один `curl` подписывал бы чужой аккаунт на
 * свои уведомления. Endpoint валидируется до записи (`lib/push-subscription.ts`): это адрес,
 * по которому НАШ сервер потом сам делает POST по расписанию.
 *
 * Игровой стейт этот путь не трогает вообще — `store.mutate` здесь нет (то же правило, что у
 * Telegram-бота: напоминание не может начислить стек).
 */
import { NextRequest } from "next/server";
import { jsonNoStore, readJsonBody, resolveIdentity, sameOriginOk } from "@/lib/http";
import { publicKeyForClient, pushConfigured } from "@/lib/push";
import { parseSubscription } from "@/lib/push-subscription";
import { allowPushSubscribe } from "@/lib/ratelimit";
import { noteSecurityEvent } from "@/lib/security-log";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!pushConfigured()) {
    // Фича за флагом: без полного набора env веб-пуши выключены целиком, а не наполовину.
    return jsonNoStore({ configured: false, publicKey: null, subscriptions: 0 });
  }
  const identity = await resolveIdentity(req);
  const store = await getStore();
  return jsonNoStore({
    configured: true,
    publicKey: publicKeyForClient(),
    subscriptions: await store.countPushSubscriptions(identity),
  });
}

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req)) {
    noteSecurityEvent("bad_origin");
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }
  if (!pushConfigured()) {
    return jsonNoStore({ error: "not_configured" }, { status: 503 });
  }

  const identity = await resolveIdentity(req);
  const now = Date.now();
  if (!(await allowPushSubscribe(identity, now))) {
    noteSecurityEvent("rate_limited");
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    return jsonNoStore({ error: body.error }, { status: body.error === "too_large" ? 413 : 400 });
  }

  const parsed = parseSubscription(body.value);
  if (!parsed.ok) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
  }

  const store = await getStore();
  await store.savePushSubscription(identity, parsed.value, now);
  return jsonNoStore({ ok: true, subscriptions: await store.countPushSubscriptions(identity) });
}

/**
 * POST /api/push/unsubscribe — выключить веб-пуши для этого устройства.
 *
 * Запись УДАЛЯЕТСЯ физически, а не помечается флагом — то же требование, что и для отписки
 * от Telegram: «отписался» и «никогда не подписывался» должны быть неотличимы, и у нас не
 * должно оставаться адреса, по которому технически можно доставить уведомление.
 *
 * Удаление ограничено подписками ТЕКУЩЕЙ идентичности (`store.deletePushSubscription`):
 * endpoint приходит из тела запроса, и без проверки владельца тот, кто узнал чужой endpoint,
 * молча отключал бы игроку напоминания. Идемпотентно: если такой подписки нет, отвечаем
 * `removed: false`, а не ошибкой — клиент к этому моменту уже мог отписаться в браузере.
 */
import { NextRequest } from "next/server";
import { jsonNoStore, readJsonBody, resolveIdentity, sameOriginOk } from "@/lib/http";
import { pushConfigured } from "@/lib/push";
import { parseEndpointOnly } from "@/lib/push-subscription";
import { allowPushSubscribe } from "@/lib/ratelimit";
import { noteSecurityEvent } from "@/lib/security-log";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req)) {
    noteSecurityEvent("bad_origin");
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }
  if (!pushConfigured()) {
    return jsonNoStore({ error: "not_configured" }, { status: 503 });
  }

  const identity = await resolveIdentity(req);
  if (!(await allowPushSubscribe(identity, Date.now()))) {
    noteSecurityEvent("rate_limited");
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const body = await readJsonBody(req);
  if (!body.ok) {
    return jsonNoStore({ error: body.error }, { status: body.error === "too_large" ? 413 : 400 });
  }
  const endpoint = parseEndpointOnly(body.value);
  if (!endpoint) return jsonNoStore({ error: "bad_endpoint" }, { status: 400 });

  const store = await getStore();
  const removed = await store.deletePushSubscription(identity, endpoint);
  return jsonNoStore({ ok: true, removed, subscriptions: await store.countPushSubscriptions(identity) });
}

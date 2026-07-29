/**
 * GET /api/admin/security — сводка отказов безопасности за текущий и прошлый час.
 *
 * Закрыт `ADMIN_SECRET` тем же способом, что `close-week`: SHA-256 + `timingSafeEqual`.
 * Публичным этот эндпоинт быть НЕ МОЖЕТ, и это не перестраховка: по счётчикам отказов
 * атакующий видит, срабатывает ли его подбор и не пора ли сменить тактику. Мы бы сами
 * отдавали ему обратную связь о качестве атаки.
 *
 * Данных игроков здесь нет вообще — только числа по типам отказов.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { jsonNoStore } from "@/lib/http";
import { noteSecurityEvent, securitySnapshot } from "@/lib/security-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Тот же порог и та же схема сравнения, что в close-week: две разные проверки одного
 *  секрета разошлись бы, и более слабая стала бы фактической. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET ?? "";
  if (secret.length < 16) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(token), h(secret));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    // Неудачный подбор админского секрета — сам по себе событие, которое стоит считать.
    noteSecurityEvent("admin_unauthorized");
    return jsonNoStore({ error: "unauthorized" }, { status: 401 });
  }
  return jsonNoStore({ ok: true, ...(await securitySnapshot()) });
}

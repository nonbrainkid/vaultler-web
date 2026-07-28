#!/usr/bin/env node
/**
 * Финализация недели — тонкая обёртка над POST /api/admin/close-week.
 *
 * Вся логика живёт в роуте, а не здесь, специально: скрипту пришлось бы дублировать
 * `settle` и формулу дележа пула, а расхождение двух реализаций денежной логики
 * обнаружилось бы ровно в момент выплаты.
 *
 * Запуск (секрет — из окружения, не аргументом: аргументы видны в списке процессов и
 * оседают в истории шелла):
 *
 *   ADMIN_SECRET=… node scripts/close-week.mjs --dry
 *   ADMIN_SECRET=… VAULTLER_URL=https://thevaultler.fun node scripts/close-week.mjs
 *   ADMIN_SECRET=… node scripts/close-week.mjs --week=2951
 */

const base = (process.env.VAULTLER_URL || "http://localhost:3000").replace(/\/$/, "");
const secret = process.env.ADMIN_SECRET || "";

if (!secret) {
  console.error("ADMIN_SECRET не задан в окружении.");
  process.exit(2);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const weekArg = args.find((a) => a.startsWith("--week="));
const body = { dryRun };
if (weekArg) body.weekId = Number(weekArg.slice("--week=".length));

const res = await fetch(`${base}/api/admin/close-week`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify(body),
});

const data = await res.json().catch(() => null);

if (!res.ok) {
  console.error(`✗ ${res.status}`, data?.error ?? "");
  process.exit(1);
}

console.log(`\nНеделя ${data.weekId}${data.dryRun ? "  (--dry, ничего не записано)" : ""}`);
console.log(`Участников: ${data.participants} · мест в деньгах: ${data.seats}`);
if (data.notEligible > 0) {
  console.log(`Без кошелька (играли, но получить не могут): ${data.notEligible}`);
}

if (data.payouts.length === 0) {
  console.log("\nПлатить некому: ни одного подтверждённого кошелька с приростом.\n");
} else {
  console.log("\n  #  доля     прирост      адрес");
  for (const p of data.payouts) {
    const rank = String(p.rank).padStart(3);
    const pct = `${p.sharePct}%`.padStart(6);
    const gain = String(p.gain).padStart(10);
    console.log(`${rank}  ${pct}  ${gain}      ${p.address}`);
  }
  console.log(
    "\nСуммы в токенах считает владелец: пул = 50% недельных торговых фисов,\n" +
      "доля места — из колонки выше. Отправка токенов вручную, вне сайта.\n",
  );
}

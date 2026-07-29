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
  console.error(
    "ADMIN_SECRET не задан.\n\n" +
      "Он живёт в env Vercel, а этот скрипт работает с твоей машины — значит нужен и\n" +
      "локально. Впиши его строкой в .env.local (файл в .gitignore и покрыт\n" +
      "`npm run check:secrets`), скрипт подхватит сам:\n\n" +
      "  ADMIN_SECRET=…\n\n" +
      "Инлайном в командную строку не передавай: оттуда секрет оседает в истории шелла\n" +
      "и виден в списке процессов.",
  );
  process.exit(2);
}

if (base.includes("localhost") || base.includes("127.0.0.1")) {
  // Против localhost скрипт закроет НЕ ту неделю: в dev работает файловый стор с
  // тестовыми игроками, а список победителей нужен из прод-базы. Предупреждаем явно —
  // молча отработавший dry-run на пустом сторе выглядит как «победителей нет».
  console.warn(
    `⚠ VAULTLER_URL = ${base}\n` +
      "  Это локальный сервер с файловым стором, а не прод. Для настоящего прогона:\n" +
      "  VAULTLER_URL=https://thevaultler.fun npm run close:week -- --dry\n",
  );
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
console.log(`Участников: ${data.participants} · мест занято: ${data.seats}`);
console.log(
  `Из них с кошельком (кому платим): ${data.paidSeats} · сгорает: ${data.forfeitedPct}% пула`,
);
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
    "\nСуммы в токенах считает владелец: пул = половина того, что собрано с торговых\n" +
      "фисов, доля места — из колонки выше. Проценты НЕ дают в сумме 100%: доли мест\n" +
      "без кошелька и незанятых мест не выплачиваются никому и сжигаются.\n" +
      "Отправка токенов вручную, вне сайта.\n",
  );
}

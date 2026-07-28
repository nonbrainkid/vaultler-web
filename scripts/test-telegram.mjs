// Сквозной тест Telegram-бота напоминаний против запущенного dev-сервера.
//
// Отправку реальных сообщений в Telegram не проверяет (нужен настоящий токен — задание
// прямо запрещает его просить, см. docs/brief-engineer.md): sendTelegramMessage не
// бросает исключений и без валидного токена/сети просто не доставляет сообщение, а
// привязка/отписка в сторе от этого не зависят. Проверяется весь путь identity ↔ chatId:
// код → вебхук /start → привязка → /stop → отвязка, 1:1 в обе стороны, приватность
// (chatId никогда не в ответе), защита вебхука секретом, CSRF, рейт-лимит.
//
//   TELEGRAM_BOT_TOKEN=123456789:test-fake-token-not-real \
//   TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32) \
//   CRON_SECRET=$(openssl rand -base64 24) \
//   npm run dev
//
//   node scripts/test-telegram.mjs   (в другом терминале)

import { webhookUrl } from "../lib/telegram.ts";

const BASE = process.env.BASE ?? "http://localhost:3000";
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;

if (!WEBHOOK_SECRET || !CRON_SECRET) {
  console.error(
    "Нужны TELEGRAM_WEBHOOK_SECRET и CRON_SECRET в окружении ЭТОГО скрипта — те же " +
      "значения, с которыми запущен dev-сервер (см. комментарий в начале файла).",
  );
  process.exit(2);
}

function parseCookies(res, jar) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
const cookie = (jar) =>
  Object.entries(jar).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("; ");

/** Новая анонимная сессия: один GET заводит cookie в proxy.ts, как в браузере. */
async function newSession() {
  const jar = {};
  const r = await fetch(`${BASE}/api/state`, { headers: { cookie: cookie(jar) } });
  parseCookies(r, jar);
  return jar;
}

async function linkStatus(jar) {
  const r = await fetch(`${BASE}/api/telegram/link`, { headers: { cookie: cookie(jar) } });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function issueCode(jar, headers = {}) {
  const r = await fetch(`${BASE}/api/telegram/link`, {
    method: "POST",
    headers: { cookie: cookie(jar), ...headers },
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function unlinkSite(jar, headers = {}) {
  const r = await fetch(`${BASE}/api/telegram/unlink`, {
    method: "POST",
    headers: { cookie: cookie(jar), ...headers },
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

let nextUpdateId = 1;
/**
 * Симулировать апдейт от Telegram — тем же путём и секретом, что и настоящий сервис.
 *
 * Путь берётся из `webhookUrl()`, а НЕ собирается здесь из секрета: это ровно та ошибка,
 * на которой уже обожглись однажды (NOTES.md 2026-07-25, история с SIWE_STATEMENT) —
 * тест, который строит входные данные сам, проверяет себя, а не продукт. Здесь цена была
 * бы выше: разойдись формула пути между продуктом и тестом, зелёные тесты сопровождали бы
 * вебхук, который Telegram не может дозваться.
 */
const WEBHOOK_PATH = webhookUrl(BASE).split("/").pop();
async function webhook(body, { secret = WEBHOOK_PATH, header = WEBHOOK_SECRET } = {}) {
  const r = await fetch(`${BASE}/api/telegram/webhook/${secret}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(header !== null ? { "x-telegram-bot-api-secret-token": header } : {}),
    },
    body: JSON.stringify({ update_id: nextUpdateId++, ...body }),
  });
  return r.status;
}

function startMsg(chatId, text, type = "private") {
  return { message: { chat: { id: chatId, type }, text } };
}

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}`);
  cond ? pass++ : fail++;
};

// 0) health отражает статус фичи
{
  const h = await (await fetch(`${BASE}/api/health`)).json();
  check("health: telegram сконфигурирован (\"on\")", h.checks.telegram === "on");
}

// 1) статус до привязки
{
  const jar = await newSession();
  const s = await linkStatus(jar);
  check("GET link (до привязки): configured:true, linked:false", s.status === 200 && s.json.configured === true && s.json.linked === false);
  check("в ответе нет chatId ни в каком виде", !JSON.stringify(s.json).includes("chatId"));
}

// 2) полный цикл: код → /start → привязан → /stop → отвязан
{
  const jar = await newSession();
  const issued = await issueCode(jar);
  check("POST link выдаёт код и TTL", issued.status === 200 && typeof issued.json.code === "string" && issued.json.expiresInSec === 600);
  check("в ответе выдачи кода нет chatId/botUsername (единая константа — на клиенте)", !("botUsername" in issued.json) && !("chatId" in issued.json));

  const chatId = 900001;
  const st = await webhook(startMsg(chatId, `/start ${issued.json.code}`));
  check("вебхук /start отвечает 200", st === 200);

  const after = await linkStatus(jar);
  check("после /start сессия видит linked:true", after.json.linked === true);

  const reuse = await webhook(startMsg(chatId, `/start ${issued.json.code}`));
  check("повторное использование того же кода не роняет вебхук (200, но без эффекта)", reuse === 200);

  const stop = await webhook(startMsg(chatId, "/stop"));
  check("вебхук /stop отвечает 200", stop === 200);
  const afterStop = await linkStatus(jar);
  check("после /stop сессия видит linked:false (физически удалено)", afterStop.json.linked === false);
}

// 3) приватность: групповой чат не привязывается
{
  const jar = await newSession();
  const issued = await issueCode(jar);
  const st = await webhook(startMsg(900002, `/start ${issued.json.code}`, "group"));
  check("вебхук из группового чата отвечает 200 (не 500)", st === 200);
  const after = await linkStatus(jar);
  check("группа не привязывает аккаунт", after.json.linked === false);
}

// 4) 1:1 в обе стороны: тот же chatId у другого identity перехватывает привязку
{
  const jarA = await newSession();
  const jarB = await newSession();
  const chatId = 900003;

  const codeA = (await issueCode(jarA)).json.code;
  await webhook(startMsg(chatId, `/start ${codeA}`));
  check("A привязан к общему chatId", (await linkStatus(jarA)).json.linked === true);

  const codeB = (await issueCode(jarB)).json.code;
  await webhook(startMsg(chatId, `/start ${codeB}`));
  check("после привязки B к тому же chatId — A больше НЕ привязан (1:1)", (await linkStatus(jarA)).json.linked === false);
  check("B привязан", (await linkStatus(jarB)).json.linked === true);
}

// 5) отписка кнопкой на сайте (не только /stop в боте)
{
  const jar = await newSession();
  const code = (await issueCode(jar)).json.code;
  await webhook(startMsg(900004, `/start ${code}`));
  check("привязан перед проверкой кнопки сайта", (await linkStatus(jar)).json.linked === true);

  const un = await unlinkSite(jar);
  check("POST unlink отвечает ok:true", un.status === 200 && un.json.ok === true);
  check("после кнопки сайта привязка физически снята", (await linkStatus(jar)).json.linked === false);
}

// 6) вебхук: секрет — главный контроль
{
  const good = { message: { chat: { id: 1, type: "private" }, text: "/start x" } };
  const wrongPath = await webhook(good, { secret: "0".repeat(32) });
  check("неверный секрет в ПУТИ → 404 (не 401/403 — не подтверждаем существование роута)", wrongPath === 404);

  const wrongHeader = await webhook(good, { header: "0".repeat(32) });
  check("неверный секрет в ЗАГОЛОВКЕ (путь верный) → тоже 404", wrongHeader === 404);

  const noHeader = await webhook(good, { header: null });
  check("заголовок secret_token отсутствует вовсе → 404", noHeader === 404);
}

// 7) CSRF: чужой Origin отклоняется на мутирующих POST
{
  const jar = await newSession();
  const evilHeaders = { origin: "https://evil.example" };
  const r1 = await issueCode(jar, evilHeaders);
  check("POST /api/telegram/link с чужого origin → 403", r1.status === 403);
  const r2 = await unlinkSite(jar, evilHeaders);
  check("POST /api/telegram/unlink с чужого origin → 403", r2.status === 403);
}

// 8) рейт-лимит выдачи кода (5 / 10 мин на identity)
{
  const jar = await newSession();
  const results = [];
  for (let i = 0; i < 6; i++) results.push((await issueCode(jar)).status);
  check("6-й запрос за короткое время → 429 (лимит 5)", results.filter((s) => s === 429).length >= 1);
}

// 9) крон рассылки: секрет обязателен
{
  const noAuth = await fetch(`${BASE}/api/telegram/remind`, { method: "POST" });
  check("без Authorization → 401", noAuth.status === 401);

  const badAuth = await fetch(`${BASE}/api/telegram/remind`, {
    method: "POST",
    headers: { authorization: "Bearer wrong-secret" },
  });
  check("неверный секрет крона → 401", badAuth.status === 401);

  const okAuth = await fetch(`${BASE}/api/telegram/remind`, {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
  const okJson = await okAuth.json().catch(() => ({}));
  check("верный секрет крона → 200 с summary", okAuth.status === 200 && okJson.ok === true && typeof okJson.due === "number");
}

console.log(`\n${fail === 0 ? "✅" : "❌"} passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);

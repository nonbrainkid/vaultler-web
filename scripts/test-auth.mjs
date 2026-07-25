// Ручной тест SIWE-флоу против запущенного dev-сервера.
// Проверяет и успешный вход, и что защита реально отвергает плохие подписи.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
// Именно настоящая константа, а не своя копия: с захардкоженным ASCII-текстом тест
// проверял сообщение, которого приложение никогда не отправляет, и пропустил поломку
// (длинное тире в statement — кошельки отказывались подписывать).
import { SIWE_STATEMENT } from "../lib/auth.ts";

const BASE = process.env.BASE ?? "http://localhost:3000";
const HOST = new URL(BASE).host;

function parseCookies(res, jar) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
const cookieHeader = (jar) =>
  Object.entries(jar)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

async function getNonce(jar) {
  const r = await fetch(`${BASE}/api/auth/nonce`, { headers: { cookie: cookieHeader(jar) } });
  parseCookies(r, jar);
  return (await r.json()).nonce;
}

async function verify(jar, message, signature) {
  const r = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
    body: JSON.stringify({ message, signature }),
  });
  parseCookies(r, jar);
  return r;
}

function siwe(account, nonce, overrides = {}) {
  const issuedAt = new Date();
  return createSiweMessage({
    domain: HOST,
    address: account.address,
    statement: SIWE_STATEMENT,
    uri: BASE,
    version: "1",
    chainId: 88991,
    nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 5 * 60 * 1000),
    ...overrides,
  });
}

let pass = 0;
let failCount = 0;
const check = (name, cond) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}`);
  cond ? pass++ : failCount++;
};

const acct = privateKeyToAccount(generatePrivateKey());
console.log("test address:", acct.address);

// 1) валидный вход
{
  const jar = {};
  const nonce = await getNonce(jar);
  const msg = siwe(acct, nonce);
  const sig = await acct.signMessage({ message: msg });
  const r = await verify(jar, msg, sig);
  check("валидный SIWE → 200", r.status === 200);
  const s = await (await fetch(`${BASE}/api/state`, { headers: { cookie: cookieHeader(jar) } })).json();
  check("сессия привязана к адресу", s.wallet?.toLowerCase() === acct.address.toLowerCase());
}

// 2) фишинг: чужой домен в сообщении → отказ
{
  const jar = {};
  const nonce = await getNonce(jar);
  const msg = siwe(acct, nonce, { domain: "evil-phishing.example" });
  const sig = await acct.signMessage({ message: msg });
  const r = await verify(jar, msg, sig);
  check("чужой домен → 401 (анти-фишинг)", r.status === 401);
}

// 3) чужой nonce (не тот, что в cookie) → отказ
{
  const jar = {};
  await getNonce(jar);
  const msg = siwe(acct, "0000deadbeef0000");
  const sig = await acct.signMessage({ message: msg });
  const r = await verify(jar, msg, sig);
  check("чужой nonce → 401 (анти-replay)", r.status === 401);
}

// 4) протухшая подпись → отказ
{
  const jar = {};
  const nonce = await getNonce(jar);
  const past = new Date(Date.now() - 10 * 60 * 1000);
  const msg = siwe(acct, nonce, { issuedAt: past, expirationTime: new Date(past.getTime() + 60_000) });
  const sig = await acct.signMessage({ message: msg });
  const r = await verify(jar, msg, sig);
  check("протухшая подпись → 401", r.status === 401);
}

// 5) битая подпись → отказ
{
  const jar = {};
  const nonce = await getNonce(jar);
  const msg = siwe(acct, nonce);
  const r = await verify(jar, msg, "0xdeadbeef");
  check("битая подпись → 400/401", r.status === 400 || r.status === 401);
}

// 6) подпись другим ключом под валидное сообщение → отказ
{
  const jar = {};
  const nonce = await getNonce(jar);
  const msg = siwe(acct, nonce);
  const other = privateKeyToAccount(generatePrivateKey());
  const sig = await other.signMessage({ message: msg }); // подписал не тот адрес
  const r = await verify(jar, msg, sig);
  check("подпись чужим ключом → 401", r.status === 401);
}

// 7) подпись без expirationTime → отказ.
// viem проверяет срок, ТОЛЬКО если поле есть: сообщение без него валидно вечно,
// и одна утёкшая подпись пускала бы в аккаунт бессрочно.
{
  const jar = {};
  const nonce = await getNonce(jar);
  const msg = siwe(acct, nonce, { expirationTime: undefined });
  const sig = await acct.signMessage({ message: msg });
  const r = await verify(jar, msg, sig);
  check("подпись без срока действия → 401", r.status === 401);
}

// 8) подпись со сроком на месяц вперёд → отказ (окно должно быть коротким)
{
  const jar = {};
  const nonce = await getNonce(jar);
  const issuedAt = new Date();
  const msg = siwe(acct, nonce, {
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
  });
  const sig = await acct.signMessage({ message: msg });
  const r = await verify(jar, msg, sig);
  check("срок действия сверх нашего окна → 401", r.status === 401);
}

// 9) вход с чужого origin → отказ (CSRF-слой поверх SameSite)
{
  const jar = {};
  const nonce = await getNonce(jar);
  const msg = siwe(acct, nonce);
  const sig = await acct.signMessage({ message: msg });
  const r = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader(jar),
      origin: "https://evil-phishing.example",
    },
    body: JSON.stringify({ message: msg, signature: sig }),
  });
  check("POST с чужого origin → 403", r.status === 403);
}

// 10) захват чужого аккаунта заголовком идентичности → не проходит.
// Заголовок x-vaultler-id ставит proxy, но роут проверяет его подпись сам: без
// SESSION_SECRET подделать нельзя. Иначе один curl давал бы доступ к любому кошельку.
{
  const victim = "wallet:0x1111111111111111111111111111111111111111";
  const r = await fetch(`${BASE}/api/state`, { headers: { "x-vaultler-id": victim } });
  const s = await r.json();
  check("подделка x-vaultler-id → чужая сессия не выдана", s.wallet === null);
}

// 11) персональные ответы не должны кэшироваться (Set-Cookie в общем кэше = чужой аккаунт)
{
  const r = await fetch(`${BASE}/api/state`);
  const cc = r.headers.get("cache-control") ?? "";
  check("на /api/state стоит no-store", cc.includes("no-store"));
}

console.log(`\n${failCount === 0 ? "✅" : "❌"} passed ${pass}, failed ${failCount}`);
process.exit(failCount === 0 ? 0 : 1);

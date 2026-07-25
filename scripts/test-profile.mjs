// Сквозной тест профиля: вход кошельком → ник → уникальность → приватность адреса.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const BASE = process.env.BASE ?? "http://localhost:3000";
const HOST = new URL(BASE).host;

function parseCookies(res, jar) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
const cookie = (jar) =>
  Object.entries(jar).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("; ");

async function login(jar, account) {
  const nres = await fetch(`${BASE}/api/auth/nonce`, { headers: { cookie: cookie(jar) } });
  parseCookies(nres, jar);
  const { nonce } = await nres.json();
  const issuedAt = new Date();
  const msg = createSiweMessage({
    domain: HOST, address: account.address, statement: "Sign in.", uri: BASE,
    version: "1", chainId: 88991, nonce, issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 300000),
  });
  const signature = await account.signMessage({ message: msg });
  const v = await fetch(`${BASE}/api/auth/verify`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookie(jar) },
    body: JSON.stringify({ message: msg, signature }),
  });
  parseCookies(v, jar);
  return v.status;
}

async function profile(jar, body) {
  const r = await fetch(`${BASE}/api/profile`, {
    method: "POST", headers: { "content-type": "application/json", cookie: cookie(jar) },
    body: JSON.stringify(body),
  });
  parseCookies(r, jar);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

let pass = 0, fail = 0;
const check = (n, c) => { console.log(`${c ? "  ✓" : "  ✗"} ${n}`); c ? pass++ : fail++; };

// аноним не может ставить ник
{
  const jar = {};
  const r = await profile(jar, { nickname: "Anonymous1" });
  check("аноним → 403 (нужен кошелёк)", r.status === 403);
}

const nick = "Stacker_" + Math.floor(Math.random() * 1e6);
let addrA;
// игрок A логинится и ставит ник
{
  const jar = {};
  const a = privateKeyToAccount(generatePrivateKey());
  addrA = a.address;
  await login(jar, a);
  const r = await profile(jar, { nickname: nick });
  check("A ставит ник → 200", r.status === 200 && r.json.nickname === nick);

  // тот же ник в другом регистре занят для B
  const jarB = {};
  await login(jarB, privateKeyToAccount(generatePrivateKey()));
  const rb = await profile(jarB, { nickname: nick.toUpperCase() });
  check("B: тот же ник (иной регистр) → 409 taken", rb.status === 409 && rb.json.error === "nickname_taken");

  // невалидный ник
  const rbad = await profile(jar, { nickname: "bad name!" });
  check("невалидный ник → 400", rbad.status === 400);

  // зарезервированный
  const rres = await profile(jar, { nickname: "admin" });
  check("зарезервированный → 400 reserved", rres.status === 400 && rres.json.error === "reserved");
}

// приватность: по умолчанию адрес виден на борде, после скрытия — нет
{
  // A уже на борде? нужно чтобы у A был стек — крутанём A заново
  const jar = {};
  const a = privateKeyToAccount(generatePrivateKey());
  await login(jar, a);
  await fetch(`${BASE}/api/crank`, { method: "POST", headers: { cookie: cookie(jar) } });
  await profile(jar, { nickname: "Visible_" + Math.floor(Math.random() * 1e6) });

  const before = await (await fetch(`${BASE}/api/leaderboard`, { headers: { cookie: cookie(jar) } })).json();
  const meBefore = before.top.find((r) => r.isYou);
  if (!meBefore) {
    // на борде засеяны боты — свежий игрок не в топ-10; логика приватности покрыта юнит-тестами
    console.log("  ↷ privacy live-check пропущен (не в топ-10 из-за ботов; см. leaderboard.test.ts)");
  } else {
    check("по умолчанию адрес открыт на борде",
      meBefore.address && meBefore.address.toLowerCase() === a.address.toLowerCase());
    await profile(jar, { hideWallet: true });
    const after = await (await fetch(`${BASE}/api/leaderboard`, { headers: { cookie: cookie(jar) } })).json();
    const meAfter = after.top.find((r) => r.isYou);
    check("после скрытия адрес не отдаётся", !!meAfter && meAfter.address === null);
  }
}

// гонка: два кошелька одновременно берут ОДИН ник → ровно один побеждает
{
  const nickRace = "Race_" + Math.floor(Math.random() * 1e9);
  const jar1 = {}, jar2 = {};
  await login(jar1, privateKeyToAccount(generatePrivateKey()));
  await login(jar2, privateKeyToAccount(generatePrivateKey()));
  const [r1, r2] = await Promise.all([
    profile(jar1, { nickname: nickRace }),
    profile(jar2, { nickname: nickRace }),
  ]);
  const wins = [r1, r2].filter((r) => r.status === 200).length;
  const taken = [r1, r2].filter((r) => r.json.error === "nickname_taken").length;
  check("гонка за ник: ровно один 200, другой taken", wins === 1 && taken === 1);
}

console.log(`\n${fail === 0 ? "✅" : "❌"} passed ${pass}, failed ${fail}`);
process.exit(fail === 0 ? 0 : 1);

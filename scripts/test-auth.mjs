// Ручной тест SIWE-флоу против запущенного dev-сервера.
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

const BASE = process.env.BASE ?? "http://localhost:3005";

function buildAuthMessage(address, nonce) {
  return [
    "The Vaultler — Sign in to stack.",
    "",
    "This only proves you own this wallet.",
    "No transaction, no gas, no funds moved.",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
  ].join("\n");
}

// вытащить пары name=value из заголовков set-cookie
function parseCookies(res, jar) {
  const raw = res.headers.getSetCookie?.() ?? [];
  for (const c of raw) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    jar[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
}
function cookieHeader(jar) {
  return Object.entries(jar)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

const jar = {};
const acct = privateKeyToAccount(generatePrivateKey());
console.log("test address:", acct.address);

// 1) nonce
const nRes = await fetch(`${BASE}/api/auth/nonce`, { headers: { cookie: cookieHeader(jar) } });
parseCookies(nRes, jar);
const { nonce } = await nRes.json();
console.log("nonce:", nonce);

// 2) sign
const message = buildAuthMessage(acct.address, nonce);
const signature = await acct.signMessage({ message });

// 3) verify
const vRes = await fetch(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookieHeader(jar) },
  body: JSON.stringify({ address: acct.address, signature }),
});
parseCookies(vRes, jar);
const vJson = await vRes.json();
console.log("verify:", vRes.status, JSON.stringify(vJson).slice(0, 160));

// 4) state под wallet-сессией
const sRes = await fetch(`${BASE}/api/state`, { headers: { cookie: cookieHeader(jar) } });
const sJson = await sRes.json();
console.log("state.wallet:", sJson.wallet, "| boost:", sJson.view.boost);

// 5) negative: битая подпись
const bad = await fetch(`${BASE}/api/auth/verify`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie: cookieHeader({ vaultler_nonce: nonce }) },
  body: JSON.stringify({ address: acct.address, signature: "0xdeadbeef" }),
});
console.log("bad signature status (ожидаем 4xx):", bad.status);

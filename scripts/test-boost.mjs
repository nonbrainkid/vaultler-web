/**
 * E2E-проверка холдерского буста ×5 против НАСТОЯЩЕГО чейна.
 *
 * Зачем отдельный скрипт: буст — единственное место, где игровая экономика зависит от
 * внешнего состояния (баланс токена on-chain). Юнит-тесты покрывают порог и порядок
 * применения, но не отвечают на вопрос «сервер вообще умеет читать баланс и реагировать
 * на его изменение». Здесь проверяется именно это.
 *
 * Главный кейс — регрессия на эксплойт: раньше буст писался только при логине, поэтому
 * можно было войти с токеном, тут же продать его и стакать ×5 бесконечно.
 *
 * Требует:
 *   1) anvil на RPC_URL с задеплоенным mock-ERC20 (mint/burn открыты);
 *   2) dev-сервер с GAME_MODE=demo и теми же NEXT_PUBLIC_RH_* / NEXT_PUBLIC_VLTR_*.
 * Полный рецепт — docs/testing.md.
 */
import { privateKeyToAccount, generatePrivateKey, mnemonicToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createWalletClient, createPublicClient, http, parseUnits } from "viem";
// Настоящая константа, а не копия: иначе тест подписывает сообщение, которого
// приложение не отправляет (так и пропустили несовместимый statement).
import { SIWE_STATEMENT } from "../lib/auth.ts";

const BASE = process.env.BASE ?? "http://localhost:3100";
const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const TOKEN = process.env.TOKEN_ADDRESS;
const CHAIN_ID = Number(process.env.CHAIN_ID ?? "88991");
/** Демо-тайминги сервера: 30с завод / 15с окно. */
const WIND_MS = Number(process.env.WIND_MS ?? "30000");
/**
 * Стандартная мнемоника anvil — из неё выводится тестовый аккаунт #0, который деплоил
 * mock-токен и потому может звать mint/burn.
 *
 * Именно мнемоника, а не готовый приватный ключ: сырой `0x`+64 hex в репозитории
 * отвергает аудит секретов (`npm run check:secrets`), и правильно делает — исключений
 * быть не должно, иначе рядом однажды окажется настоящий ключ.
 */
const ANVIL_MNEMONIC =
  process.env.ANVIL_MNEMONIC ?? "test test test test test test test test test test test junk";

if (!TOKEN) {
  console.error("Нужен TOKEN_ADDRESS (адрес mock-ERC20 в anvil).");
  process.exit(2);
}

const HOST = new URL(BASE).host;
const chain = {
  id: CHAIN_ID,
  name: "local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
};
const MOCK_ABI = [
  { type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "burn", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" },
  { type: "function", name: "balanceOf", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
];

const admin = mnemonicToAccount(ANVIL_MNEMONIC);
const wallet = createWalletClient({ account: admin, chain, transport: http(RPC_URL) });
const pub = createPublicClient({ chain, transport: http(RPC_URL) });

async function setBalance(to, tokens) {
  const current = await pub.readContract({ address: TOKEN, abi: MOCK_ABI, functionName: "balanceOf", args: [to] });
  const target = parseUnits(String(tokens), 18);
  if (target === current) return;
  const hash =
    target > current
      ? await wallet.writeContract({ address: TOKEN, abi: MOCK_ABI, functionName: "mint", args: [to, target - current] })
      : await wallet.writeContract({ address: TOKEN, abi: MOCK_ABI, functionName: "burn", args: [to, current - target] });
  await pub.waitForTransactionReceipt({ hash });
}

// ── HTTP-сессия ──
function parseCookies(res, jar) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
const cookieHeader = (jar) =>
  Object.entries(jar).filter(([, v]) => v !== "").map(([k, v]) => `${k}=${v}`).join("; ");

async function api(jar, path, init = {}) {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), cookie: cookieHeader(jar) },
    cache: "no-store",
  });
  parseCookies(r, jar);
  return r;
}

async function signIn(jar, account) {
  const nonce = (await (await api(jar, "/api/auth/nonce")).json()).nonce;
  const issuedAt = new Date();
  const message = createSiweMessage({
    domain: HOST,
    address: account.address,
    statement: SIWE_STATEMENT,
    uri: BASE,
    version: "1",
    chainId: CHAIN_ID,
    nonce,
    issuedAt,
    expirationTime: new Date(issuedAt.getTime() + 5 * 60 * 1000),
  });
  const signature = await account.signMessage({ message });
  const r = await api(jar, "/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  if (!r.ok) throw new Error(`вход не прошёл: ${r.status}`);
  return r.json();
}

const crank = async (jar) => (await api(jar, "/api/crank", { method: "POST" })).json();
const refreshBoost = async (jar) => (await api(jar, "/api/boost/refresh", { method: "POST" })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, cond) => {
  console.log(`${cond ? "  ✓" : "  ✗"} ${name}`);
  cond ? pass++ : fail++;
};

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  const jar = {};
  console.log(`игрок: ${account.address}`);
  console.log(`токен: ${TOKEN}\n`);

  await setBalance(account.address, 0);
  await signIn(jar, account);

  // ── без токена ──
  let s = await refreshBoost(jar);
  check("нет токена → буста нет", s.boost === false);
  check("значение подтверждено (сеть отвечает)", s.stale === false);

  // ── порог ──
  await setBalance(account.address, 0.5);
  s = await refreshBoost(jar);
  check("баланс ниже порога (0.5 < 1) → буста нет", s.boost === false);

  await setBalance(account.address, 1);
  s = await refreshBoost(jar);
  check("ровно порог (1 токен) → буст включился", s.boost === true);

  // ── буст доезжает до игровой ставки, а не только до флага ──
  await setBalance(account.address, 5);
  let c = await crank(jar);
  check("кранк принят", c.ok === true);
  check("кранк зафиксировал буст холдера", c.view.boost === true);
  check("множитель вырос в 5 раз (×1.2 → ×6)", Math.abs(c.view.multiplier - 6) < 1e-9);

  // ── ГЛАВНОЕ: продажа токена снимает буст на следующем кранке ──
  await setBalance(account.address, 0);
  const afterSell = await refreshBoost(jar);
  check("продал токен → re-check сразу показывает, что буста нет", afterSell.boost === false);

  console.log(`  … ждём конца завода (${WIND_MS / 1000}с), чтобы кранкнуть снова`);
  await sleep(WIND_MS + 1500);

  c = await crank(jar);
  check("следующий кранк принят", c.ok === true);
  check(
    "ЭКСПЛОЙТ ЗАКРЫТ: после продажи токена кранк больше не даёт ×5",
    c.view.boost === false,
  );
  check("множитель вернулся к обычному", c.view.multiplier < 6);

  // ── обратный сценарий: купил после логина — буст доступен без перелогина ──
  await setBalance(account.address, 3);
  s = await refreshBoost(jar);
  check("купил токен после входа → буст доступен без перелогина", s.boost === true);

  // ── аноним ──
  const anonJar = {};
  const anon = await refreshBoost(anonJar);
  check("анонимная сессия → буста нет", anon.boost === false);

  console.log(`\n${fail === 0 ? "✅" : "❌"} passed ${pass}, failed ${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("сорвалось:", e);
  process.exit(1);
});

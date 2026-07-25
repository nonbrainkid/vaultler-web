/**
 * POST /api/auth/verify — проверить SIWE-подпись и сделать адрес идентичностью игрока.
 *
 * Что именно проверяется (EIP-4361):
 *  1) домен в подписанном сообщении == наш ПРИПИНЕННЫЙ домен → защита от фишинга/релея;
 *  2) nonce == выданный нами одноразовый           → защита от повтора старой подписи;
 *  3) срок действия: expirationTime ОБЯЗАТЕЛЕН и не длиннее нашего окна;
 *  4) сама подпись валидна для адреса из сообщения  → доказательство владения кошельком.
 *
 * Мы НИЧЕГО не подписываем от имени юзера и не шлём транзакций — только читаем подпись
 * сообщения и публичный баланс $VLTR. Задрейнить через этот флоу нечего.
 */
import { NextRequest } from "next/server";
import { verifyMessage, isAddress } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import {
  AuthDomainNotConfigured,
  NONCE_COOKIE,
  SIWE_CLOCK_SKEW_MS,
  SIWE_TTL_MS,
  expectedAuthDomain,
  walletIdentity,
} from "@/lib/auth";
import { SESSION_COOKIE, SESSION_TTL_MS, signedCookieValue } from "@/lib/session";
import { computeBoost } from "@/lib/vltr";
import { getStore } from "@/lib/store";
import { settle, toPublicView } from "@/lib/game";
import { allowAuth, clientKey } from "@/lib/ratelimit";
import { jsonNoStore, readJsonBody, resolveIdentity, sameOriginOk } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LEN = 2000;
/** Потолок для подписи: обычная — 132 символа, ERC-1271 длиннее, но не безразмерна. */
const MAX_SIGNATURE_LEN = 4096;

export async function POST(req: NextRequest) {
  if (!sameOriginOk(req)) {
    return jsonNoStore({ error: "bad_origin" }, { status: 403 });
  }

  if (!(await allowAuth(clientKey(req, await resolveIdentity(req)), Date.now()))) {
    return jsonNoStore({ error: "rate_limited" }, { status: 429 });
  }

  const parsedBody = await readJsonBody(req);
  if (!parsedBody.ok) {
    return jsonNoStore(
      { error: parsedBody.error },
      { status: parsedBody.error === "too_large" ? 413 : 400 },
    );
  }
  const { message, signature } = parsedBody.value as {
    message?: unknown;
    signature?: unknown;
  };
  if (
    typeof message !== "string" ||
    message.length > MAX_MESSAGE_LEN ||
    typeof signature !== "string" ||
    signature.length > MAX_SIGNATURE_LEN ||
    !/^0x[0-9a-fA-F]+$/.test(signature)
  ) {
    return jsonNoStore({ error: "bad_params" }, { status: 400 });
  }

  const nonce = req.cookies.get(NONCE_COOKIE)?.value;
  if (!nonce) {
    return jsonNoStore({ error: "nonce_missing" }, { status: 400 });
  }

  // Домен пиним из env. Не задан в проде — это ошибка конфигурации, а не повод
  // молча проверять подпись против заголовка Host, который присылает сам запрос.
  let domain: string;
  try {
    domain = expectedAuthDomain(req.headers.get("host"));
  } catch (e) {
    if (e instanceof AuthDomainNotConfigured) {
      console.error("[auth/verify]", e.message);
      return jsonNoStore({ error: "server_misconfigured" }, { status: 500 });
    }
    throw e;
  }

  const parsed = parseSiweMessage(message);
  const address = parsed.address;
  if (!address || !isAddress(address)) {
    return jsonNoStore({ error: "bad_message" }, { status: 400 });
  }

  const now = Date.now();

  /**
   * Срок жизни подписи проверяем сами, а не только через validateSiweMessage: тот
   * сверяет expirationTime, ТОЛЬКО ЕСЛИ поле есть. Сообщение без него валидно вечно —
   * одна утёкшая подпись пускала бы в аккаунт бессрочно. Требуем поле и держим окно
   * коротким: пойманная подпись должна протухать за минуты, а не за годы.
   */
  const expiresAt = parsed.expirationTime?.getTime();
  if (expiresAt === undefined || !Number.isFinite(expiresAt)) {
    return jsonNoStore({ error: "message_rejected" }, { status: 401 });
  }
  if (expiresAt - now > SIWE_TTL_MS + SIWE_CLOCK_SKEW_MS) {
    return jsonNoStore({ error: "message_rejected" }, { status: 401 });
  }
  // Версия EIP-4361 — часть контракта: чужая версия означает другой формат разбора.
  if (parsed.version !== "1") {
    return jsonNoStore({ error: "message_rejected" }, { status: 401 });
  }
  // uri обязан указывать на нас же: домен и адрес страницы не должны расходиться.
  try {
    if (!parsed.uri || new URL(parsed.uri).host !== domain) {
      return jsonNoStore({ error: "message_rejected" }, { status: 401 });
    }
  } catch {
    return jsonNoStore({ error: "message_rejected" }, { status: 401 });
  }

  // 1–3: поля сообщения (домен/nonce/срок)
  const fieldsOk = validateSiweMessage({
    message: parsed,
    domain,
    nonce,
    time: new Date(now),
  });
  if (!fieldsOk) {
    return jsonNoStore({ error: "message_rejected" }, { status: 401 });
  }

  // 4: подпись над сырым сообщением принадлежит адресу из сообщения
  let sigOk = false;
  try {
    sigOk = await verifyMessage({
      address,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return jsonNoStore({ error: "bad_signature" }, { status: 401 });
  }

  const identity = walletIdentity(address);
  const boost = await computeBoost(address); // серверное чтение on-chain

  const store = await getStore();
  const { state } = await store.mutate(identity, now, (s) => {
    const r = settle(s, now);
    // null — RPC не ответил: оставляем прежнее значение, а не снимаем буст.
    if (boost !== null) r.state.boost = boost;
    return { state: r.state, result: r };
  });

  // Наружу отдаём адрес, а не внутренний id (`wallet:0x…`): формат идентичности —
  // деталь хранилища, и ей нечего делать в публичном контракте API.
  const res = jsonNoStore({
    ok: true,
    address: address.toLowerCase(),
    view: toPublicView(state, now),
  });
  res.cookies.set(SESSION_COOKIE, await signedCookieValue(identity, now), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 }); // одноразовый — гасим
  return res;
}

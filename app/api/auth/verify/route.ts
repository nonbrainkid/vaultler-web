/**
 * POST /api/auth/verify — проверить SIWE-подпись и сделать адрес идентичностью игрока.
 *
 * Что именно проверяется (EIP-4361):
 *  1) домен в подписанном сообщении == наш домен  → защита от фишинга/replay на чужом сайте;
 *  2) nonce == выданный нами одноразовый           → защита от повтора старой подписи;
 *  3) срок действия (expirationTime)               → пойманная подпись быстро протухает;
 *  4) сама подпись валидна для адреса из сообщения  → доказательство владения кошельком.
 *
 * Мы НИЧЕГО не подписываем от имени юзера и не шлём транзакций — только читаем подпись
 * сообщения и публичный баланс $VLTR. Задрейнить через этот флоу нечего.
 */
import { NextRequest, NextResponse } from "next/server";
import { verifyMessage, isAddress } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import {
  NONCE_COOKIE,
  expectedAuthDomain,
  walletIdentity,
} from "@/lib/auth";
import { SESSION_COOKIE, signedCookieValue } from "@/lib/session";
import { computeBoost } from "@/lib/vltr";
import { getStore } from "@/lib/store";
import { settle, toPublicView } from "@/lib/game";
import { allowAuth, clientKey } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGE_LEN = 2000;

export async function POST(req: NextRequest) {
  if (!allowAuth(clientKey(req), Date.now())) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: { message?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_body" }, { status: 400 });
  }
  const { message, signature } = body;
  if (
    typeof message !== "string" ||
    message.length > MAX_MESSAGE_LEN ||
    typeof signature !== "string" ||
    !/^0x[0-9a-fA-F]+$/.test(signature)
  ) {
    return NextResponse.json({ error: "bad_params" }, { status: 400 });
  }

  const nonce = req.cookies.get(NONCE_COOKIE)?.value;
  if (!nonce) {
    return NextResponse.json({ error: "nonce_missing" }, { status: 400 });
  }

  const parsed = parseSiweMessage(message);
  const address = parsed.address;
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "bad_message" }, { status: 400 });
  }

  // 1–3: поля сообщения (домен/nonce/срок)
  const fieldsOk = validateSiweMessage({
    message: parsed,
    domain: expectedAuthDomain(req.headers.get("host")),
    nonce,
    time: new Date(),
  });
  if (!fieldsOk) {
    return NextResponse.json({ error: "message_rejected" }, { status: 401 });
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
    return NextResponse.json({ error: "bad_signature" }, { status: 401 });
  }

  const identity = walletIdentity(address);
  const now = Date.now();
  const boost = await computeBoost(address); // серверное чтение on-chain

  const store = await getStore();
  const { state } = await store.mutate(identity, now, (s) => {
    const r = settle(s, now);
    r.state.boost = boost;
    return { state: r.state, result: r };
  });

  const res = NextResponse.json({
    ok: true,
    identity,
    view: toPublicView(state, now),
  });
  res.cookies.set(SESSION_COOKIE, await signedCookieValue(identity), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 365,
  });
  res.cookies.set(NONCE_COOKIE, "", { path: "/", maxAge: 0 }); // одноразовый — гасим
  return res;
}

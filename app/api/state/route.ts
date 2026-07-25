/**
 * GET /api/state — текущий стейт игрока для отрисовки.
 * Read-only: settle считается в памяти только для отображения и НЕ персистится
 * (стек детерминирован из таймстемпов; запись происходит на кранке). Так поллинг дешёвый.
 */
import { NextRequest, NextResponse } from "next/server";
import { settle, toPublicView } from "@/lib/game";
import { getStore } from "@/lib/store";
import { resolveIdentity } from "@/lib/http";
import { addressFromIdentity } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const identity = await resolveIdentity(req);
  const now = Date.now();

  const store = await getStore();
  const stored = await store.read(identity, now);
  const settled = settle(stored, now); // только для отображения, без записи

  return NextResponse.json({
    view: toPublicView(settled.state, now),
    raid: settled.raid, // если игрок как раз простоял окно — покажем рейд
    wallet: addressFromIdentity(identity), // адрес, если сессия привязана к кошельку
    nickname: settled.state.nickname, // свой ник (для редактора)
    hideWallet: settled.state.hideWallet, // своя настройка приватности
  });
}

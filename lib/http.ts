/** Общие хелперы для API-роутов: резолв идентичности из cookie и её установка на ответ. */
import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  identityFromCookie,
  newIdentity,
  signedCookieValue,
} from "./session";

export interface Resolved {
  identity: string;
  isNew: boolean;
}

export function resolveIdentity(req: NextRequest): Resolved {
  const raw = req.cookies.get(SESSION_COOKIE)?.value;
  const id = identityFromCookie(raw);
  if (id) return { identity: id, isNew: false };
  return { identity: newIdentity(), isNew: true };
}

/** Проставить подписанную session-cookie на ответ (для новых игроков). */
export function attachSession(res: NextResponse, r: Resolved): NextResponse {
  if (r.isNew) {
    res.cookies.set(SESSION_COOKIE, signedCookieValue(r.identity), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365, // 1 год
    });
  }
  return res;
}

import { NextResponse } from "next/server";

import { SESSION_COOKIE_NAME, SESSION_EXPIRED_LOGIN_PATH } from "@/server/auth/session";

/**
 * Landing point when a page finds the session cookie is expired, revoked or
 * unknown. Server Components cannot delete cookies, so they redirect here;
 * this route clears the stale cookie and sends the user to the login page.
 * Without this, middleware saw the stale cookie on /login and bounced the
 * user back into the app, creating a redirect loop that only deleting
 * cookies by hand could break.
 */
export function GET(request: Request) {
  const url = new URL(SESSION_EXPIRED_LOGIN_PATH, request.url);
  const response = NextResponse.redirect(url);
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  canUseCockpitSessionCookies,
  createCockpitSessionCookieValue,
  getCockpitSessionCookieOptions,
  isCockpitAuthRequired,
  sanitizeNextPath,
  verifyCockpitPassword,
} from "@/lib/signalops/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const next = sanitizeNextPath(form.get("next"));
  const target = new URL(next, request.url);

  if (!isCockpitAuthRequired()) {
    return NextResponse.redirect(target, { status: 303 });
  }

  const password = form.get("password");
  if (typeof password !== "string" || !verifyCockpitPassword(password)) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "1");
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  if (!canUseCockpitSessionCookies()) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("error", "session_secret");
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl, { status: 303 });
  }

  const response = NextResponse.redirect(target, { status: 303 });
  response.cookies.set(SESSION_COOKIE, createCockpitSessionCookieValue(), getCockpitSessionCookieOptions());
  return response;
}

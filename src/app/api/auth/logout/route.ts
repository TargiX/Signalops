import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/signalops/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/", request.url), { status: 303 });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function GET(request: Request) {
  return POST(request);
}

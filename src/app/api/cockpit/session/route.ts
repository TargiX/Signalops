import { NextResponse } from "next/server";

import {
  clearSignalOpsOperatorSessionCookieV1,
  createSignalOpsOperatorSessionTokenV1,
  isSignalOpsOperatorAuthConfiguredV1,
  readSignalOpsOperatorSessionV1,
  serializeSignalOpsOperatorSessionCookieV1,
  verifySignalOpsOperatorPasswordV1,
} from "@/lib/signalops/v1/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = readSignalOpsOperatorSessionV1(request);
  return NextResponse.json(
    { ok: Boolean(session), configured: isSignalOpsOperatorAuthConfiguredV1(), session },
    { status: session ? 200 : 401, headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!isSignalOpsOperatorAuthConfiguredV1()) {
    return NextResponse.json(
      { ok: false, code: "operator_auth_not_configured" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  let password: unknown;
  try {
    const body = (await request.json()) as { password?: unknown };
    password = body.password;
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json" }, { status: 400 });
  }
  if (!verifySignalOpsOperatorPasswordV1(password)) {
    return NextResponse.json(
      { ok: false, code: "invalid_credentials" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }
  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.headers.set(
    "set-cookie",
    serializeSignalOpsOperatorSessionCookieV1(createSignalOpsOperatorSessionTokenV1()),
  );
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  response.headers.set("set-cookie", clearSignalOpsOperatorSessionCookieV1());
  return response;
}

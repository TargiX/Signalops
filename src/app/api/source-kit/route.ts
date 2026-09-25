import { NextResponse } from "next/server";

import { buildSourceKit } from "@/lib/signalops/source-kit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const configuredBaseUrl = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL;
  const baseUrl = configuredBaseUrl || new URL(request.url).origin;

  return NextResponse.json({ ok: true, kit: buildSourceKit(baseUrl) }, { status: 200 });
}

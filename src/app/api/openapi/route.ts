import { NextResponse } from "next/server";

import { buildOpenApiSpec } from "@/lib/signalops/openapi";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(buildOpenApiSpec());
}


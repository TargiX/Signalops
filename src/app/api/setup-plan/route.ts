import { NextResponse } from "next/server";

import { buildSetupPlan } from "@/lib/signalops/setup-plan";

export const runtime = "nodejs";

export async function GET() {
  const plan = await buildSetupPlan();

  return NextResponse.json({
    ok: true,
    plan,
  });
}

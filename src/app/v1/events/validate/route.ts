import { NextResponse } from "next/server";

import { resolveSignalOpsTenantPrincipalV1 } from "@/lib/signalops/v1/auth";
import { normalizeSignalOpsEventBatchV1 } from "@/lib/signalops/v1/contract";
import { SignalOpsHttpErrorV1, readSignalOpsJsonBodyV1 } from "@/lib/signalops/v1/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    const principal = await resolveSignalOpsTenantPrincipalV1(request);
    if (!principal || !principal.scopes.includes("events:validate")) {
      return NextResponse.json(
        { ok: false, requestId, code: "unauthorized", message: "A validation-scoped tenant credential is required." },
        { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
    const batch = normalizeSignalOpsEventBatchV1(await readSignalOpsJsonBodyV1(request));
    return NextResponse.json(
      {
        ok: batch.rejected.length === 0,
        requestId,
        validEvents: batch.events.length,
        rejectedEvents: batch.rejected.length,
        rejected: batch.rejected,
      },
      { status: 200, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    const status = error instanceof SignalOpsHttpErrorV1 ? error.status : 400;
    const code = error instanceof SignalOpsHttpErrorV1 ? error.code : "invalid_batch";
    return NextResponse.json(
      { ok: false, requestId, code, message: error instanceof Error ? error.message : "Invalid request." },
      { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}

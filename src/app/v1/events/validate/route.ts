import { NextResponse } from "next/server";

import { resolveSignalOpsTenantPrincipalV1 } from "@/lib/signalops/v1/auth";
import { normalizeSignalOpsEventBatchV1 } from "@/lib/signalops/v1/contract";
import { SignalOpsHttpErrorV1, readSignalOpsJsonBodyV1 } from "@/lib/signalops/v1/http";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    await enforceSignalOpsRateLimitV1({
      scope: "validate-origin",
      identifier: signalOpsRequestFingerprintV1(request),
      limit: 120,
      windowSeconds: 60,
    });
    const principal = await resolveSignalOpsTenantPrincipalV1(request);
    if (!principal || !principal.scopes.includes("events:validate")) {
      return NextResponse.json(
        { ok: false, requestId, code: "unauthorized", message: "A validation-scoped tenant credential is required." },
        { status: 401, headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "validate-credential",
      identifier: `${principal.tenantId}:${principal.credentialId}`,
      limit: 300,
      windowSeconds: 60,
    });
    const batch = normalizeSignalOpsEventBatchV1(await readSignalOpsJsonBodyV1(request));
    return NextResponse.json(
      {
        ok: batch.rejected.length === 0,
        requestId,
        validEvents: batch.events.length,
        rejectedEvents: batch.rejected.length,
        rejected: batch.rejected,
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
          ...signalOpsRateLimitHeadersV1(decision),
        },
      },
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return NextResponse.json(
        { ok: false, requestId, code: "rate_limited", message: "Rate limit exceeded." },
        {
          status: 429,
          headers: {
            "cache-control": "no-store",
            "x-request-id": requestId,
            ...signalOpsRateLimitHeadersV1(error.decision),
          },
        },
      );
    }
    const status = error instanceof SignalOpsHttpErrorV1 ? error.status : 400;
    const code = error instanceof SignalOpsHttpErrorV1 ? error.code : "invalid_batch";
    return NextResponse.json(
      { ok: false, requestId, code, message: error instanceof Error ? error.message : "Invalid request." },
      { status, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  }
}

import { NextResponse } from "next/server";

import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import type { SignalOpsOpsRangeV1 } from "@/lib/signalops/v1/ops-snapshot";
import { getSignalOpsOpsSnapshotV1 } from "@/lib/signalops/v1/projection-service";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

const ranges = new Set<SignalOpsOpsRangeV1>(["24h", "7d", "30d", "90d"]);

export async function GET(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, requestId, code: "operator_session_required" },
      { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
  const requestedRange = new URL(request.url).searchParams.get("range") ?? "24h";
  if (!ranges.has(requestedRange as SignalOpsOpsRangeV1)) {
    return NextResponse.json(
      { ok: false, requestId, code: "invalid_range" },
      { status: 400, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
  const range = requestedRange as SignalOpsOpsRangeV1;
  try {
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "operator-query",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 180,
      windowSeconds: 60,
    });
    const snapshot = await getSignalOpsOpsSnapshotV1({
      tenantId: session.tenantId,
      tenantName: session.tenantName,
      range,
    });
    return NextResponse.json(
      { ok: true, requestId, snapshot },
      {
        headers: {
          "cache-control": "private, no-store",
          "x-request-id": requestId,
          ...signalOpsRateLimitHeadersV1(decision),
        },
      },
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return NextResponse.json(
        { ok: false, requestId, code: "rate_limited" },
        {
          status: 429,
          headers: {
            "cache-control": "private, no-store",
            "x-request-id": requestId,
            ...signalOpsRateLimitHeadersV1(error.decision),
          },
        },
      );
    }
    console.error("[SignalOps] snapshot failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: "projection_unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
}

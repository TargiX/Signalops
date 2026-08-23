import { NextResponse } from "next/server";

import {
  listSignalOpsIncidentsV1,
  type SignalOpsIncidentStateV1,
} from "@/lib/signalops/v1/incidents";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, requestId, code: "operator_session_required" },
      { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
  const search = new URL(request.url).searchParams;
  const requestedState = search.get("state");
  if (requestedState && requestedState !== "open" && requestedState !== "resolved") {
    return NextResponse.json(
      { ok: false, requestId, code: "invalid_state" },
      { status: 400, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
  const state = requestedState as SignalOpsIncidentStateV1 | null;
  const limit = Math.max(1, Math.min(Number(search.get("limit") ?? 100) || 100, 500));
  try {
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-incidents",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 120,
      windowSeconds: 60,
    });
    const incidents = await listSignalOpsIncidentsV1({
      tenantId: session.tenantId,
      state: state ?? undefined,
      limit,
    });
    return NextResponse.json(
      { ok: true, requestId, incidents, nextCursor: null },
      {
        headers: {
          "cache-control": "private, no-store",
          "x-request-id": requestId,
          ...signalOpsRateLimitHeadersV1(rateLimit),
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
    console.error("[SignalOps] incidents query failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: "incidents_unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
}

import { NextResponse } from "next/server";

import {
  isSignalOpsOperationIdV1,
} from "@/lib/signalops/v1/operation-trace";
import { getSignalOpsOperationTraceV1 } from "@/lib/signalops/v1/operation-trace-service";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

const privateHeaders = {
  "cache-control": "private, no-store",
};

export async function GET(
  request: Request,
  context: { params: Promise<{ operationId: string }> },
) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, requestId, code: "operator_session_required" },
      {
        status: 401,
        headers: { ...privateHeaders, "x-request-id": requestId },
      },
    );
  }

  const { operationId } = await context.params;
  if (!isSignalOpsOperationIdV1(operationId)) {
    return NextResponse.json(
      { ok: false, requestId, code: "operation_not_found" },
      {
        status: 404,
        headers: { ...privateHeaders, "x-request-id": requestId },
      },
    );
  }

  try {
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-operation-trace",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 120,
      windowSeconds: 60,
    });
    const trace = await getSignalOpsOperationTraceV1({
      tenantId: session.tenantId,
      operationId,
    });
    return trace
      ? NextResponse.json(
          { ok: true, requestId, trace },
          {
            headers: {
              ...privateHeaders,
              "x-request-id": requestId,
              ...signalOpsRateLimitHeadersV1(rateLimit),
            },
          },
        )
      : NextResponse.json(
          { ok: false, requestId, code: "operation_not_found" },
          {
            status: 404,
            headers: {
              ...privateHeaders,
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
            ...privateHeaders,
            "x-request-id": requestId,
            ...signalOpsRateLimitHeadersV1(error.decision),
          },
        },
      );
    }
    console.error("[SignalOps] operation trace failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: "operation_trace_unavailable" },
      {
        status: 503,
        headers: { ...privateHeaders, "x-request-id": requestId },
      },
    );
  }
}

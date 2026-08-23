import { NextResponse } from "next/server";

import { getSignalOpsIncidentV1 } from "@/lib/signalops/v1/incidents";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import { enforceSignalOpsRateLimitV1 } from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return NextResponse.json(
      { ok: false, requestId, code: "operator_session_required" },
      { status: 401, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
  const { id } = await context.params;
  if (!/^inc_[a-f0-9]{24}$/.test(id)) {
    return NextResponse.json(
      { ok: false, requestId, code: "incident_not_found" },
      { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
  try {
    await enforceSignalOpsRateLimitV1({
      scope: "operator-incidents",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 120,
      windowSeconds: 60,
    });
    const incident = await getSignalOpsIncidentV1({ tenantId: session.tenantId, incidentId: id });
    return incident
      ? NextResponse.json(
          { ok: true, requestId, incident },
          { headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
        )
      : NextResponse.json(
          { ok: false, requestId, code: "incident_not_found" },
          { status: 404, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
        );
  } catch (error) {
    console.error("[SignalOps] incident lookup failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: "incidents_unavailable" },
      { status: 503, headers: { "cache-control": "private, no-store", "x-request-id": requestId } },
    );
  }
}

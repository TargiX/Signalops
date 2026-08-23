import { NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import {
  assertSignalOpsSameOriginV1,
  isSignalOpsJsonObjectV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import {
  getSignalOpsIncidentV1,
  listSignalOpsIncidentTransitionsV1,
  setSignalOpsIncidentAcknowledgementV1,
} from "@/lib/signalops/v1/incidents";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      ...headers,
    },
  });
}

function validIncidentId(id: string): boolean {
  return /^inc_[a-f0-9]{24}$/.test(id);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return json({ ok: false, requestId, code: "operator_session_required" }, 401, {
      "x-request-id": requestId,
    });
  }
  const { id } = await context.params;
  if (!validIncidentId(id)) {
    return json({ ok: false, requestId, code: "incident_not_found" }, 404, {
      "x-request-id": requestId,
    });
  }
  try {
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-incidents",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 120,
      windowSeconds: 60,
    });
    const [incident, history] = await Promise.all([
      getSignalOpsIncidentV1({ tenantId: session.tenantId, incidentId: id }),
      listSignalOpsIncidentTransitionsV1({
        tenantId: session.tenantId,
        incidentId: id,
      }),
    ]);
    return incident
      ? json(
          { ok: true, requestId, incident, history },
          200,
          {
            "x-request-id": requestId,
            ...signalOpsRateLimitHeadersV1(rateLimit),
          },
        )
      : json(
          { ok: false, requestId, code: "incident_not_found" },
          404,
          { "x-request-id": requestId },
        );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return json(
        { ok: false, requestId, code: "rate_limited" },
        429,
        {
          "x-request-id": requestId,
          ...signalOpsRateLimitHeadersV1(error.decision),
        },
      );
    }
    console.error("[SignalOps] incident lookup failed", { requestId, error });
    return json({ ok: false, requestId, code: "incidents_unavailable" }, 503, {
      "x-request-id": requestId,
    });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return json({ ok: false, requestId, code: "operator_session_required" }, 401, {
      "x-request-id": requestId,
    });
  }
  if (session.role === "viewer") {
    return json({ ok: false, requestId, code: "operator_role_required" }, 403, {
      "x-request-id": requestId,
    });
  }
  const { id } = await context.params;
  if (!validIncidentId(id)) {
    return json({ ok: false, requestId, code: "incident_not_found" }, 404, {
      "x-request-id": requestId,
    });
  }

  try {
    assertSignalOpsSameOriginV1(request);
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-incident-action",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 30,
      windowSeconds: 60,
    });
    const body = await readSignalOpsJsonBodyV1(request, 2 * 1_024);
    if (!isSignalOpsJsonObjectV1(body)) {
      return json({ ok: false, requestId, code: "invalid_incident_action" }, 400, {
        "x-request-id": requestId,
      });
    }
    if (body.action !== "acknowledge" && body.action !== "unacknowledge") {
      return json({ ok: false, requestId, code: "invalid_incident_action" }, 400, {
        "x-request-id": requestId,
      });
    }
    if (body.note !== undefined && typeof body.note !== "string") {
      return json({ ok: false, requestId, code: "invalid_acknowledgement_note" }, 400, {
        "x-request-id": requestId,
      });
    }

    const result = await setSignalOpsIncidentAcknowledgementV1({
      tenantId: session.tenantId,
      incidentId: id,
      actorSubject: session.subject,
      acknowledged: body.action === "acknowledge",
      note: typeof body.note === "string" ? body.note : null,
    });
    if (!result.incident) {
      return json({ ok: false, requestId, code: "incident_not_found" }, 404, {
        "x-request-id": requestId,
      });
    }
    if (result.incident.state === "resolved") {
      return json({ ok: false, requestId, code: "incident_resolved" }, 409, {
        "x-request-id": requestId,
      });
    }
    if (result.changed) {
      await writeSignalOpsAuditEventV1({
        tenantId: session.tenantId,
        actorSubject: session.subject,
        action:
          body.action === "acknowledge"
            ? "incident.acknowledged"
            : "incident.unacknowledged",
        target: id,
        requestId,
        metadata: { role: session.role },
      });
    }
    const history = await listSignalOpsIncidentTransitionsV1({
      tenantId: session.tenantId,
      incidentId: id,
    });
    return json(
      { ok: true, requestId, incident: result.incident, history, changed: result.changed },
      200,
      {
        "x-request-id": requestId,
        ...signalOpsRateLimitHeadersV1(rateLimit),
      },
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return json(
        { ok: false, requestId, code: "rate_limited" },
        429,
        {
          "x-request-id": requestId,
          ...signalOpsRateLimitHeadersV1(error.decision),
        },
      );
    }
    if (error instanceof SignalOpsHttpErrorV1) {
      return json({ ok: false, requestId, code: error.code }, error.status, {
        "x-request-id": requestId,
      });
    }
    console.error("[SignalOps] incident action failed", { requestId, incidentId: id, error });
    return json({ ok: false, requestId, code: "incident_action_failed" }, 503, {
      "x-request-id": requestId,
    });
  }
}

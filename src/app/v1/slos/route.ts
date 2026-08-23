import { NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import {
  assertSignalOpsSameOriginV1,
  isSignalOpsJsonObjectV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import { getSignalOpsOpsSnapshotV1 } from "@/lib/signalops/v1/projection-service";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";
import {
  evaluateSignalOpsSloPoliciesV1,
  listSignalOpsSloPoliciesV1,
  updateSignalOpsSloPolicyV1,
} from "@/lib/signalops/v1/slo";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}

async function readEvaluation(tenantId: string, tenantName: string) {
  const [snapshot, policies] = await Promise.all([
    getSignalOpsOpsSnapshotV1({ tenantId, tenantName, range: "24h" }),
    listSignalOpsSloPoliciesV1(tenantId),
  ]);
  return {
    policies,
    evaluations: evaluateSignalOpsSloPoliciesV1({ snapshot, policies }),
    generatedAt: snapshot.generatedAt,
  };
}

export async function GET(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return json({ ok: false, requestId, code: "operator_session_required" }, 401, {
      "x-request-id": requestId,
    });
  }
  try {
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-slos",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 120,
      windowSeconds: 60,
    });
    const result = await readEvaluation(session.tenantId, session.tenantName);
    return json({ ok: true, requestId, ...result }, 200, {
      "x-request-id": requestId,
      ...signalOpsRateLimitHeadersV1(rateLimit),
    });
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return json({ ok: false, requestId, code: "rate_limited" }, 429, {
        "x-request-id": requestId,
        ...signalOpsRateLimitHeadersV1(error.decision),
      });
    }
    console.error("[SignalOps] SLO query failed", { requestId, error });
    return json({ ok: false, requestId, code: "slos_unavailable" }, 503, {
      "x-request-id": requestId,
    });
  }
}

export async function PATCH(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  if (!session) {
    return json({ ok: false, requestId, code: "operator_session_required" }, 401, {
      "x-request-id": requestId,
    });
  }
  if (session.role !== "owner") {
    return json({ ok: false, requestId, code: "owner_role_required" }, 403, {
      "x-request-id": requestId,
    });
  }

  try {
    assertSignalOpsSameOriginV1(request);
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-slo-update",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 20,
      windowSeconds: 60,
    });
    const body = await readSignalOpsJsonBodyV1(request, 4 * 1_024);
    if (!isSignalOpsJsonObjectV1(body)) {
      return json({ ok: false, requestId, code: "invalid_slo_policy" }, 400, {
        "x-request-id": requestId,
      });
    }
    if (typeof body.policyId !== "string" || !/^slo_[a-z0-9_]{3,80}$/.test(body.policyId)) {
      return json({ ok: false, requestId, code: "invalid_slo_policy" }, 400, {
        "x-request-id": requestId,
      });
    }

    const patch: Parameters<typeof updateSignalOpsSloPolicyV1>[0]["patch"] = {};
    const numericFields = [
      "objective",
      "warningThreshold",
      "criticalThreshold",
      "minimumSample",
    ] as const;
    for (const field of numericFields) {
      if (body[field] === undefined) continue;
      if (typeof body[field] !== "number" || !Number.isFinite(body[field])) {
        return json({ ok: false, requestId, code: `invalid_${field}` }, 400, {
          "x-request-id": requestId,
        });
      }
      const value = body[field];
      if (field === "objective") patch.objective = value;
      if (field === "warningThreshold") patch.warningThreshold = value;
      if (field === "criticalThreshold") patch.criticalThreshold = value;
      if (field === "minimumSample") patch.minimumSample = value;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        return json({ ok: false, requestId, code: "invalid_enabled" }, 400, {
          "x-request-id": requestId,
        });
      }
      patch.enabled = body.enabled;
    }
    if (Object.keys(patch).length === 0) {
      return json({ ok: false, requestId, code: "empty_slo_policy_patch" }, 400, {
        "x-request-id": requestId,
      });
    }

    const policy = await updateSignalOpsSloPolicyV1({
      tenantId: session.tenantId,
      policyId: body.policyId,
      actorSubject: session.subject,
      patch,
    });
    if (!policy) {
      return json({ ok: false, requestId, code: "slo_policy_not_found" }, 404, {
        "x-request-id": requestId,
      });
    }
    await writeSignalOpsAuditEventV1({
      tenantId: session.tenantId,
      actorSubject: session.subject,
      action: "slo.policy_updated",
      target: policy.id,
      requestId,
      metadata: { version: policy.version },
    });
    const result = await readEvaluation(session.tenantId, session.tenantName);
    return json({ ok: true, requestId, policy, ...result }, 200, {
      "x-request-id": requestId,
      ...signalOpsRateLimitHeadersV1(rateLimit),
    });
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return json({ ok: false, requestId, code: "rate_limited" }, 429, {
        "x-request-id": requestId,
        ...signalOpsRateLimitHeadersV1(error.decision),
      });
    }
    if (error instanceof SignalOpsHttpErrorV1) {
      return json({ ok: false, requestId, code: error.code }, error.status, {
        "x-request-id": requestId,
      });
    }
    if (error instanceof Error && error.message.startsWith("invalid_")) {
      return json({ ok: false, requestId, code: error.message }, 400, {
        "x-request-id": requestId,
      });
    }
    console.error("[SignalOps] SLO update failed", { requestId, error });
    return json({ ok: false, requestId, code: "slo_update_failed" }, 503, {
      "x-request-id": requestId,
    });
  }
}

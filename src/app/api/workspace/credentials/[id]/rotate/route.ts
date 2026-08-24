import { NextResponse } from "next/server";

import { captureServerProductEvent } from "@/lib/posthog-server";
import {
  assertSignalOpsSameOriginV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";
import { rotateSignalOpsIngestCredentialV1 } from "@/lib/signalops/v1/workspace-provisioning";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    assertSignalOpsSameOriginV1(request);
    const session = await authorizeSignalOpsOperatorSessionV1(request);
    if (!session) return json({ ok: false, requestId, code: "operator_session_required" }, 401);
    if (session.role !== "owner") return json({ ok: false, requestId, code: "owner_required" }, 403);
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "credential-rotate",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 12,
      windowSeconds: 60 * 60,
    });
    const body = (await readSignalOpsJsonBodyV1(request, 4 * 1_024)) as {
      name?: unknown;
      expiresInDays?: unknown;
    };
    const expiresInDays = body.expiresInDays === undefined ? 90 : Number(body.expiresInDays);
    const { id } = await context.params;
    const issued = await rotateSignalOpsIngestCredentialV1({
      tenantId: session.tenantId,
      subject: session.subject,
      credentialId: id,
      name: body.name,
      expiresInDays,
      requestId,
    });
    await captureServerProductEvent({
      distinctId: session.subject,
      event: "ingest_key_rotated",
      properties: { expires_in_days: expiresInDays, scope_count: issued.credential.scopes.length },
      groups: { workspace: session.tenantId },
    });
    return json(
      { ok: true, requestId, credential: issued.credential, token: issued.token },
      201,
      signalOpsRateLimitHeadersV1(decision),
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return json(
        { ok: false, requestId, code: "rate_limited" },
        429,
        signalOpsRateLimitHeadersV1(error.decision),
      );
    }
    if (error instanceof SignalOpsHttpErrorV1) {
      return json({ ok: false, requestId, code: error.code }, error.status);
    }
    if (error instanceof TypeError) {
      return json({ ok: false, requestId, code: "invalid_credential", message: error.message }, 400);
    }
    const conflict = error instanceof Error && /duplicate key|unique constraint/i.test(error.message);
    console.error("[SignalOps] credential rotation failed", { requestId, error });
    return json(
      { ok: false, requestId, code: conflict ? "credential_rotation_conflict" : "credential_rotation_failed" },
      conflict ? 409 : 503,
    );
  }
}

import { NextResponse } from "next/server";

import { captureServerProductEvent } from "@/lib/posthog-server";
import { assertSignalOpsSameOriginV1, SignalOpsHttpErrorV1 } from "@/lib/signalops/v1/http";
import { authorizeSignalOpsOperatorSessionV1 } from "@/lib/signalops/v1/operator-session";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
} from "@/lib/signalops/v1/rate-limit";
import { revokeSignalOpsIngestCredentialV1 } from "@/lib/signalops/v1/workspace-provisioning";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}

export async function DELETE(
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
      scope: "credential-revoke",
      identifier: `${session.subject}:${session.tenantId}`,
      limit: 30,
      windowSeconds: 60 * 60,
    });
    const { id } = await context.params;
    const revoked = await revokeSignalOpsIngestCredentialV1({
      tenantId: session.tenantId,
      subject: session.subject,
      credentialId: id,
      requestId,
    });
    await captureServerProductEvent({
      distinctId: session.subject,
      event: "ingest_key_revoked",
      properties: { lifecycle: "manual" },
      groups: { workspace: session.tenantId },
    });
    return json({ ok: true, requestId, credential: revoked }, 200, signalOpsRateLimitHeadersV1(decision));
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
      return json({ ok: false, requestId, code: "invalid_credential" }, 400);
    }
    console.error("[SignalOps] credential revocation failed", { requestId, error });
    return json({ ok: false, requestId, code: "credential_revocation_failed" }, 503);
  }
}

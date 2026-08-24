import { NextResponse } from "next/server";

import { captureServerProductEvent } from "@/lib/posthog-server";
import {
  assertSignalOpsSameOriginV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import { listSignalOpsOperatorMembershipsV1 } from "@/lib/signalops/v1/operator-directory";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";
import {
  createSignalOpsOperatorSessionTokenV1,
  serializeSignalOpsOperatorSessionCookieV1,
} from "@/lib/signalops/v1/session";
import { getSignalOpsSupabaseUserV1 } from "@/lib/signalops/v1/supabase-auth";
import {
  isSignalOpsPublicSignupEnabledV1,
  provisionSignalOpsWorkspaceV1,
} from "@/lib/signalops/v1/workspace-provisioning";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}

export async function GET() {
  if (!isSignalOpsPublicSignupEnabledV1()) {
    return json({ ok: false, code: "public_signup_disabled" }, 404);
  }
  const user = await getSignalOpsSupabaseUserV1();
  if (!user) return json({ ok: false, code: "account_session_required" }, 401);
  const memberships = await listSignalOpsOperatorMembershipsV1(user.id);
  return json({ ok: true, account: true, memberships });
}

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    assertSignalOpsSameOriginV1(request);
    if (!isSignalOpsPublicSignupEnabledV1()) {
      return json({ ok: false, requestId, code: "public_signup_disabled" }, 403);
    }
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "self-serve-workspace",
      identifier: signalOpsRequestFingerprintV1(request),
      limit: 8,
      windowSeconds: 60 * 60,
    });
    const user = await getSignalOpsSupabaseUserV1();
    if (!user) return json({ ok: false, requestId, code: "account_session_required" }, 401);
    const body = (await readSignalOpsJsonBodyV1(request, 4 * 1_024)) as {
      workspaceName?: unknown;
    };
    const workspace = await provisionSignalOpsWorkspaceV1({
      subject: user.id,
      workspaceName: body.workspaceName,
      requestId,
    });
    const token = createSignalOpsOperatorSessionTokenV1({
      tenantId: workspace.tenantId,
      tenantName: workspace.tenantName,
      role: workspace.role,
      subject: user.id,
      authMode: "supabase",
    });
    if (workspace.created) {
      await captureServerProductEvent({
        distinctId: user.id,
        event: "workspace_created",
        properties: { role: "owner", provisioning: "self_serve" },
        groups: { workspace: workspace.tenantId },
      });
    }
    const response = json(
      { ok: true, requestId, workspace },
      workspace.created ? 201 : 200,
      signalOpsRateLimitHeadersV1(decision),
    );
    response.headers.set("set-cookie", serializeSignalOpsOperatorSessionCookieV1(token));
    return response;
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
      return json({ ok: false, requestId, code: "invalid_workspace", message: error.message }, 400);
    }
    console.error("[SignalOps] self-serve workspace provisioning failed", { requestId, error });
    return json({ ok: false, requestId, code: "workspace_provisioning_failed" }, 503);
  }
}

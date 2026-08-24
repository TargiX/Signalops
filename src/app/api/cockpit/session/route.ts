import { NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import {
  assertSignalOpsSameOriginV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import { resolveSignalOpsOperatorMembershipV1 } from "@/lib/signalops/v1/operator-directory";
import {
  authorizeSignalOpsOperatorSessionV1,
  listAuthorizedSignalOpsMembershipsV1,
} from "@/lib/signalops/v1/operator-session";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";
import {
  clearSignalOpsOperatorSessionCookieV1,
  configuredSignalOpsTenantV1,
  createSignalOpsOperatorSessionTokenV1,
  isSignalOpsOperatorAuthConfiguredV1,
  serializeSignalOpsOperatorSessionCookieV1,
  verifySignalOpsOperatorPasswordV1,
} from "@/lib/signalops/v1/session";
import {
  createSignalOpsSupabaseServerClientV1,
  isSignalOpsEmailOtpEnabledV1,
  isSignalOpsSupabaseAuthConfiguredV1,
  signalOpsAllowedAuthProvidersV1,
} from "@/lib/signalops/v1/supabase-auth";
import { isSignalOpsPublicSignupEnabledV1 } from "@/lib/signalops/v1/workspace-provisioning";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store", ...headers },
  });
}

export async function GET(request: Request) {
  const session = await authorizeSignalOpsOperatorSessionV1(request);
  const memberships = session ? await listAuthorizedSignalOpsMembershipsV1(session) : [];
  return json(
    {
      ok: Boolean(session),
      configured:
        isSignalOpsOperatorAuthConfiguredV1() || isSignalOpsSupabaseAuthConfiguredV1(),
      auth: {
        password: isSignalOpsOperatorAuthConfiguredV1(),
        supabase: isSignalOpsSupabaseAuthConfiguredV1(),
        emailOtp: isSignalOpsEmailOtpEnabledV1(),
        providers: signalOpsAllowedAuthProvidersV1(),
        publicSignup: isSignalOpsPublicSignupEnabledV1(),
      },
      session,
      memberships,
    },
    session ? 200 : 401,
  );
}

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  const fingerprint = signalOpsRequestFingerprintV1(request);
  try {
    assertSignalOpsSameOriginV1(request);
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "operator-session",
      identifier: fingerprint,
      limit: 10,
      windowSeconds: 15 * 60,
    });
    const body = (await readSignalOpsJsonBodyV1(request, 4 * 1_024)) as {
      password?: unknown;
      tenantId?: unknown;
    };

    if (typeof body.tenantId === "string") {
      const current = await authorizeSignalOpsOperatorSessionV1(request);
      if (!current) return json({ ok: false, requestId, code: "operator_session_required" }, 401);
      const localTenant = configuredSignalOpsTenantV1();
      const membership =
        current.authMode === "password"
          ? body.tenantId === localTenant.id
            ? { tenantId: localTenant.id, tenantName: localTenant.name, role: current.role }
            : null
          : await resolveSignalOpsOperatorMembershipV1({
              subject: current.subject,
              tenantId: body.tenantId,
            });
      if (!membership) return json({ ok: false, requestId, code: "tenant_forbidden" }, 403);

      const token = createSignalOpsOperatorSessionTokenV1({
        ...membership,
        subject: current.subject,
        authMode: current.authMode,
      });
      await writeSignalOpsAuditEventV1({
        tenantId: membership.tenantId,
        actorSubject: current.subject,
        action: "operator.tenant_switched",
        target: membership.tenantId,
        requestId,
      });
      const response = json({ ok: true, requestId }, 200, signalOpsRateLimitHeadersV1(decision));
      response.headers.set("set-cookie", serializeSignalOpsOperatorSessionCookieV1(token));
      return response;
    }

    if (!isSignalOpsOperatorAuthConfiguredV1()) {
      return json({ ok: false, requestId, code: "password_auth_not_configured" }, 503);
    }
    if (!verifySignalOpsOperatorPasswordV1(body.password)) {
      await writeSignalOpsAuditEventV1({
        actorSubject: `request:${fingerprint}`,
        action: "operator.password_rejected",
        requestId,
      });
      return json(
        { ok: false, requestId, code: "invalid_credentials" },
        401,
        signalOpsRateLimitHeadersV1(decision),
      );
    }

    const tenant = configuredSignalOpsTenantV1();
    const token = createSignalOpsOperatorSessionTokenV1();
    await writeSignalOpsAuditEventV1({
      tenantId: tenant.id,
      actorSubject: process.env.SIGNALOPS_OPERATOR_SUBJECT?.trim() || "workspace-operator",
      action: "operator.password_authenticated",
      requestId,
    });
    const response = json({ ok: true, requestId }, 200, signalOpsRateLimitHeadersV1(decision));
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
    console.error("[SignalOps] operator session failed", { requestId, error });
    return json({ ok: false, requestId, code: "operator_auth_unavailable" }, 503);
  }
}

export async function DELETE(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    assertSignalOpsSameOriginV1(request);
    const session = await authorizeSignalOpsOperatorSessionV1(request);
    if (session?.authMode === "supabase" && isSignalOpsSupabaseAuthConfiguredV1()) {
      const client = await createSignalOpsSupabaseServerClientV1();
      await client.auth.signOut();
    }
    if (session) {
      await writeSignalOpsAuditEventV1({
        tenantId: session.tenantId,
        actorSubject: session.subject,
        action: "operator.signed_out",
        requestId,
      });
    }
    const response = json({ ok: true, requestId });
    response.headers.set("set-cookie", clearSignalOpsOperatorSessionCookieV1());
    return response;
  } catch (error) {
    if (error instanceof SignalOpsHttpErrorV1) {
      return json({ ok: false, requestId, code: error.code }, error.status);
    }
    return json({ ok: false, requestId, code: "sign_out_failed" }, 503);
  }
}

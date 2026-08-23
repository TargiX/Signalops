import { NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import { listSignalOpsOperatorMembershipsV1 } from "@/lib/signalops/v1/operator-directory";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";
import {
  createSignalOpsOperatorSessionTokenV1,
  serializeSignalOpsOperatorSessionCookieV1,
} from "@/lib/signalops/v1/session";
import {
  createSignalOpsSupabaseServerClientV1,
  signalOpsPublicOriginV1,
} from "@/lib/signalops/v1/supabase-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = signalOpsPublicOriginV1(request);
  const requestId = `req_${crypto.randomUUID()}`;
  const code = new URL(request.url).searchParams.get("code");
  if (!code) return NextResponse.redirect(`${origin}/cockpit?auth=callback-invalid`);

  try {
    await enforceSignalOpsRateLimitV1({
      scope: "operator-oauth-callback",
      identifier: signalOpsRequestFingerprintV1(request),
      limit: 30,
      windowSeconds: 15 * 60,
    });
    const client = await createSignalOpsSupabaseServerClientV1();
    const exchange = await client.auth.exchangeCodeForSession(code);
    if (exchange.error) throw exchange.error;
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) throw error ?? new Error("OAuth user is unavailable");

    const memberships = await listSignalOpsOperatorMembershipsV1(data.user.id);
    const preferredTenant = process.env.SIGNALOPS_DEFAULT_TENANT_SLUG?.trim();
    const membership =
      memberships.find((candidate) => candidate.tenantId === preferredTenant) ?? memberships[0];
    if (!membership) {
      await client.auth.signOut();
      await writeSignalOpsAuditEventV1({
        actorSubject: data.user.id,
        action: "operator.membership_rejected",
        requestId,
      });
      return NextResponse.redirect(`${origin}/cockpit?auth=membership-required`);
    }

    const token = createSignalOpsOperatorSessionTokenV1({
      ...membership,
      subject: data.user.id,
      authMode: "supabase",
    });
    await writeSignalOpsAuditEventV1({
      tenantId: membership.tenantId,
      actorSubject: data.user.id,
      action: "operator.oauth_authenticated",
      requestId,
      metadata: { role: membership.role },
    });
    const response = NextResponse.redirect(`${origin}/cockpit`, {
      headers: { "cache-control": "private, no-store" },
    });
    response.headers.append("set-cookie", serializeSignalOpsOperatorSessionCookieV1(token));
    return response;
  } catch (error) {
    console.error("[SignalOps] OAuth callback failed", { requestId, error });
    return NextResponse.redirect(`${origin}/cockpit?auth=callback-failed`);
  }
}

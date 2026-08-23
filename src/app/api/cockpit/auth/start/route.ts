import type { Provider } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import {
  enforceSignalOpsRateLimitV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";
import {
  createSignalOpsSupabaseServerClientV1,
  isSignalOpsSupabaseAuthConfiguredV1,
  signalOpsAllowedAuthProvidersV1,
  signalOpsPublicOriginV1,
} from "@/lib/signalops/v1/supabase-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = signalOpsPublicOriginV1(request);
  if (!isSignalOpsSupabaseAuthConfiguredV1()) {
    return NextResponse.redirect(`${origin}/cockpit?auth=not-configured`);
  }
  const provider = new URL(request.url).searchParams.get("provider") ?? "google";
  if (!signalOpsAllowedAuthProvidersV1().includes(provider)) {
    return NextResponse.redirect(`${origin}/cockpit?auth=provider-not-allowed`);
  }
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    const fingerprint = signalOpsRequestFingerprintV1(request);
    await enforceSignalOpsRateLimitV1({
      scope: "operator-oauth-start",
      identifier: fingerprint,
      limit: 20,
      windowSeconds: 15 * 60,
    });
    const client = await createSignalOpsSupabaseServerClientV1();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: provider as Provider,
      options: { redirectTo: `${origin}/api/cockpit/auth/callback` },
    });
    if (error || !data.url) throw error ?? new Error("OAuth redirect is unavailable");
    await writeSignalOpsAuditEventV1({
      actorSubject: `request:${fingerprint}`,
      action: "operator.oauth_started",
      requestId,
      metadata: { provider },
    });
    return NextResponse.redirect(data.url, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const authCode = error instanceof SignalOpsRateLimitErrorV1 ? "rate-limited" : "start-failed";
    return NextResponse.redirect(`${origin}/cockpit?auth=${authCode}`);
  }
}

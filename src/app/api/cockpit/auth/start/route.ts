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
import { isSignalOpsPublicSignupEnabledV1 } from "@/lib/signalops/v1/workspace-provisioning";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const origin = signalOpsPublicOriginV1(request);
  const url = new URL(request.url);
  const signup = url.searchParams.get("intent") === "signup";
  const fallback = signup ? "/onboarding" : "/cockpit";
  if (!isSignalOpsSupabaseAuthConfiguredV1()) {
    return NextResponse.redirect(`${origin}${fallback}?auth=not-configured`);
  }
  if (signup && !isSignalOpsPublicSignupEnabledV1()) {
    return NextResponse.redirect(`${origin}/onboarding?auth=signup-disabled`);
  }
  const provider = url.searchParams.get("provider") ?? "google";
  if (!signalOpsAllowedAuthProvidersV1().includes(provider)) {
    return NextResponse.redirect(`${origin}${fallback}?auth=provider-not-allowed`);
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
      options: {
        redirectTo: `${origin}/api/cockpit/auth/callback${signup ? "?intent=signup" : ""}`,
      },
    });
    if (error || !data.url) throw error ?? new Error("OAuth redirect is unavailable");
    await writeSignalOpsAuditEventV1({
      actorSubject: `request:${fingerprint}`,
      action: signup ? "operator.signup_oauth_started" : "operator.oauth_started",
      requestId,
      metadata: { provider, intent: signup ? "signup" : "signin" },
    });
    return NextResponse.redirect(data.url, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    const authCode = error instanceof SignalOpsRateLimitErrorV1 ? "rate-limited" : "start-failed";
    return NextResponse.redirect(`${origin}${fallback}?auth=${authCode}`);
  }
}

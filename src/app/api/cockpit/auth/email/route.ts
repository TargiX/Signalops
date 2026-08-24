import { NextResponse } from "next/server";

import { writeSignalOpsAuditEventV1 } from "@/lib/signalops/v1/audit";
import {
  assertSignalOpsSameOriginV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";
import {
  createSignalOpsSupabaseServerClientV1,
  isSignalOpsEmailOtpEnabledV1,
  signalOpsPublicOriginV1,
} from "@/lib/signalops/v1/supabase-auth";
import { isSignalOpsPublicSignupEnabledV1 } from "@/lib/signalops/v1/workspace-provisioning";

export const runtime = "nodejs";

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    assertSignalOpsSameOriginV1(request);
    if (!isSignalOpsEmailOtpEnabledV1()) {
      return NextResponse.json(
        { ok: false, requestId, code: "email_auth_not_configured" },
        { status: 503, headers: { "cache-control": "private, no-store" } },
      );
    }
    const fingerprint = signalOpsRequestFingerprintV1(request);
    const rateLimit = await enforceSignalOpsRateLimitV1({
      scope: "operator-email-otp",
      identifier: fingerprint,
      limit: 5,
      windowSeconds: 15 * 60,
    });
    const body = (await readSignalOpsJsonBodyV1(request, 2 * 1_024)) as {
      email?: unknown;
      intent?: unknown;
    };
    const signup = body.intent === "signup";
    if (signup && !isSignalOpsPublicSignupEnabledV1()) {
      return NextResponse.json(
        { ok: false, requestId, code: "public_signup_disabled" },
        { status: 403, headers: { "cache-control": "private, no-store" } },
      );
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!emailPattern.test(email)) {
      return NextResponse.json(
        { ok: false, requestId, code: "invalid_email" },
        { status: 400, headers: { "cache-control": "private, no-store" } },
      );
    }

    const origin = signalOpsPublicOriginV1(request);
    const client = await createSignalOpsSupabaseServerClientV1();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/api/cockpit/auth/callback${signup ? "?intent=signup" : ""}`,
        shouldCreateUser: signup,
      },
    });
    if (error) throw error;
    await writeSignalOpsAuditEventV1({
      actorSubject: `request:${fingerprint}`,
      action: signup ? "operator.signup_email_requested" : "operator.email_otp_requested",
      requestId,
      metadata: { intent: signup ? "signup" : "signin" },
    });
    return NextResponse.json(
      { ok: true, requestId },
      {
        headers: {
          "cache-control": "private, no-cache, no-store, must-revalidate",
          ...signalOpsRateLimitHeadersV1(rateLimit),
        },
      },
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return NextResponse.json(
        { ok: false, requestId, code: "rate_limited" },
        {
          status: 429,
          headers: {
            "cache-control": "private, no-store",
            ...signalOpsRateLimitHeadersV1(error.decision),
          },
        },
      );
    }
    if (error instanceof SignalOpsHttpErrorV1) {
      return NextResponse.json(
        { ok: false, requestId, code: error.code },
        { status: error.status, headers: { "cache-control": "private, no-store" } },
      );
    }
    console.error("[SignalOps] email OTP request failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: "email_delivery_failed" },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}

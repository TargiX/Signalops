import { NextResponse } from "next/server";

import { captureServerEvent } from "@/lib/posthog-server";
import {
  assertSignalOpsSameOriginV1,
  readSignalOpsJsonBodyV1,
  SignalOpsHttpErrorV1,
} from "@/lib/signalops/v1/http";
import {
  deliverSignalOpsPilotRequestV1,
  normalizeSignalOpsPilotRequestV1,
} from "@/lib/signalops/v1/pilot-request";
import {
  enforceSignalOpsRateLimitV1,
  signalOpsRateLimitHeadersV1,
  SignalOpsRateLimitErrorV1,
  signalOpsRequestFingerprintV1,
} from "@/lib/signalops/v1/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const requestId = `req_${crypto.randomUUID()}`;
  try {
    assertSignalOpsSameOriginV1(request);
    const decision = await enforceSignalOpsRateLimitV1({
      scope: "pilot-request",
      identifier: signalOpsRequestFingerprintV1(request),
      limit: 4,
      windowSeconds: 60 * 60,
    });
    const raw = (await readSignalOpsJsonBodyV1(request, 8 * 1_024)) as Record<string, unknown>;
    if (typeof raw.website === "string" && raw.website.trim()) {
      return NextResponse.json(
        { ok: true, requestId },
        { status: 202, headers: { "cache-control": "no-store", ...signalOpsRateLimitHeadersV1(decision) } },
      );
    }
    const pilot = normalizeSignalOpsPilotRequestV1(raw);
    const channel = await deliverSignalOpsPilotRequestV1(pilot, requestId);
    await captureServerEvent(request, "pilot_request_submitted", {
      category: pilot.category,
      monthly_operations: pilot.monthlyOperations,
      delivery_channel: channel,
      source_path: new URL(pilot.sourcePath, "https://signalops.cc").pathname,
    });
    return NextResponse.json(
      { ok: true, requestId },
      { status: 202, headers: { "cache-control": "no-store", ...signalOpsRateLimitHeadersV1(decision) } },
    );
  } catch (error) {
    if (error instanceof SignalOpsRateLimitErrorV1) {
      return NextResponse.json(
        { ok: false, requestId, code: "rate_limited" },
        { status: 429, headers: { "cache-control": "no-store", ...signalOpsRateLimitHeadersV1(error.decision) } },
      );
    }
    if (error instanceof SignalOpsHttpErrorV1) {
      return NextResponse.json(
        { ok: false, requestId, code: error.code },
        { status: error.status, headers: { "cache-control": "no-store" } },
      );
    }
    if (error instanceof TypeError) {
      return NextResponse.json(
        { ok: false, requestId, code: "invalid_pilot_request", message: error.message },
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const notConfigured = error instanceof Error && /not configured/i.test(error.message);
    console.error("[SignalOps] pilot request delivery failed", { requestId, error });
    return NextResponse.json(
      { ok: false, requestId, code: notConfigured ? "pilot_delivery_not_configured" : "pilot_delivery_failed" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

import { NextResponse } from "next/server";

import { captureServerEvent } from "@/lib/posthog-server";
import {
  createSignalEventErrorResponse,
  validateSignalEventRequest,
} from "@/lib/signalops/events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const response = await validateSignalEventRequest(request);
    await captureServerEvent(request, "signal_validation_completed", {
      success: response.body.ok,
      status_code: response.status,
      outcome_code: response.body.code ?? "accepted",
      valid_events: response.body.validEvents ?? 0,
      rejected_events: response.body.rejectedEvents ?? 0,
      readiness: response.body.diagnostics?.readiness,
      provider_count: response.body.diagnostics?.coverage.providers ?? 0,
      model_count: response.body.diagnostics?.coverage.models ?? 0,
    });
    return NextResponse.json(response.body, { status: response.status });
  } catch (error) {
    const response = createSignalEventErrorResponse(
      500,
      `req_${crypto.randomUUID()}`,
      "internal_error",
      "Unexpected validation error.",
    );
    await captureServerEvent(request, "signal_validation_completed", {
      success: false,
      status_code: response.status,
      outcome_code: "internal_error",
      error_type: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(response.body, { status: response.status });
  }
}

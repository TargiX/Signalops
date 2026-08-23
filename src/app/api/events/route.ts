import { NextResponse } from "next/server";

import { captureServerEvent } from "@/lib/posthog-server";
import { getSignalEventSinkForRuntime } from "@/lib/signalops/ingest-sink";
import { handleSignalEventIngest } from "@/lib/signalops/ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await handleSignalEventIngest(request, {
    sink: getSignalEventSinkForRuntime(),
  });
  const receipt = response.body.receipt as
    | {
        acceptedEvents?: number;
        rejectedEvents?: number;
        storedEvents?: number;
        duplicateEvents?: number;
        storage?: { adapter?: string; durable?: boolean };
      }
    | undefined;

  await captureServerEvent(request, "signal_ingest_completed", {
    success: response.body.ok,
    status_code: response.status,
    outcome_code: response.body.code ?? "accepted",
    accepted_events: receipt?.acceptedEvents ?? 0,
    rejected_events: receipt?.rejectedEvents ?? 0,
    stored_events: receipt?.storedEvents ?? 0,
    duplicate_events: receipt?.duplicateEvents ?? 0,
    storage_adapter: receipt?.storage?.adapter,
    durable_storage: receipt?.storage?.durable,
  });

  return NextResponse.json(response.body, {
    status: response.status,
    headers: { "cache-control": "no-store" },
  });
}

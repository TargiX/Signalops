import { NextResponse } from "next/server";

import { getSignalEventSinkForRuntime } from "@/lib/signalops/ingest-sink";
import { handleSignalEventIngest } from "@/lib/signalops/ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await handleSignalEventIngest(request, {
    sink: getSignalEventSinkForRuntime(),
  });

  return NextResponse.json(response.body, {
    status: response.status,
    headers: { "cache-control": "no-store" },
  });
}

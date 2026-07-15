import { NextResponse } from "next/server";

import {
  createSignalEventErrorResponse,
  validateSignalEventRequest,
} from "@/lib/signalops/events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const response = await validateSignalEventRequest(request);
    return NextResponse.json(response.body, { status: response.status });
  } catch {
    const response = createSignalEventErrorResponse(
      500,
      `req_${crypto.randomUUID()}`,
      "internal_error",
      "Unexpected validation error.",
    );
    return NextResponse.json(response.body, { status: response.status });
  }
}

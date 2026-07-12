import { NextResponse } from "next/server.js";

import {
  validateSignalEventRequest,
} from "../../../../lib/signalops/events";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const response = await validateSignalEventRequest(request);
  return NextResponse.json(response.body, { status: response.status });
}

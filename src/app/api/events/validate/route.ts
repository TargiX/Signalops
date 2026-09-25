import { NextResponse } from "next/server";

import { normalizeSignalEventBatch, summarizeSignalEventValidation } from "@/lib/signalops/events";
import {
  acceptsJson,
  checkSignalOpsRateLimit,
  payloadTooLargeBody,
  rateLimitedBody,
  requestContentLengthExceeds,
  unsupportedMediaTypeBody,
  utf8ByteLength,
} from "@/lib/signalops/http";
import { readSignalOpsIngestPolicy } from "@/lib/signalops/ingest-policy";

export const runtime = "nodejs";

function requestId() {
  return `req_${crypto.randomUUID()}`;
}

export async function POST(request: Request) {
  const id = requestId();
  const policy = readSignalOpsIngestPolicy();

  if (!acceptsJson(request)) {
    return NextResponse.json(unsupportedMediaTypeBody(id, ["application/json"]), { status: 415 });
  }

  if (requestContentLengthExceeds(request, policy.maxBodyBytes)) {
    return NextResponse.json(payloadTooLargeBody(id, policy.maxBodyBytes), { status: 413 });
  }

  const rateLimit = checkSignalOpsRateLimit(request, "event_validation");
  if (rateLimit.limited) {
    return NextResponse.json(rateLimitedBody(id, rateLimit), {
      status: 429,
      headers: rateLimit.headers,
    });
  }

  const rawBody = await request.text();

  if (utf8ByteLength(rawBody) > policy.maxBodyBytes) {
    return NextResponse.json(payloadTooLargeBody(id, policy.maxBodyBytes), { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json", requestId: id }, { status: 400 });
  }

  try {
    const batch = normalizeSignalEventBatch(body, policy.privacyMode, {
      maxBatchEvents: policy.maxBatchEvents,
    });
    const summary = summarizeSignalEventValidation(batch, policy.privacyMode);

    return NextResponse.json({
      ok: batch.events.length > 0,
      verificationOnly: true,
      ingestPolicy: policy,
      ...summary,
      rejected: batch.rejected,
      requestId: id,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        code: "invalid_event",
        error: error instanceof Error ? error.message : "Invalid event payload",
        requestId: id,
      },
      { status: 422 },
    );
  }
}

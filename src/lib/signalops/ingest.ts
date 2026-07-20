import { createHash } from "node:crypto";

import {
  SIGNALOPS_EVENT_LIMITS,
  acceptsApplicationJson,
  normalizeSignalEventBatch,
  readBoundedRequestBody,
  requestContentLengthExceeds,
} from "./events.ts";
import {
  authenticateSignalEventIngest,
  isSignalEventIngestConfigured,
} from "./ingest-auth.ts";
import type { SignalEventSink } from "./ingest-sink.ts";

type RuntimeEnv = Record<string, string | undefined>;

type IngestResponse = {
  status: number;
  body: Record<string, unknown> & {
    ok: boolean;
    requestId: string;
    code?: string;
    error?: string;
  };
};

function createRequestId() {
  return `req_${crypto.randomUUID()}`;
}

function isProductionRuntime(env: RuntimeEnv) {
  return env.NODE_ENV === "production" || Boolean(env.VERCEL);
}

function safeReference(prefix: "evtref" | "rcpt", value: string) {
  const digest = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
  return `${prefix}_${digest}`;
}

function errorResponse(
  status: number,
  requestId: string,
  code: string,
  error: string,
): IngestResponse {
  return {
    status,
    body: { ok: false, code, error, requestId },
  };
}

export async function handleSignalEventIngest(
  request: Request,
  options: {
    env?: RuntimeEnv;
    sink: SignalEventSink;
    requestIdFactory?: () => string;
    currentTimeMs?: number;
  },
): Promise<IngestResponse> {
  const env = options.env ?? process.env;
  const requestId = (options.requestIdFactory ?? createRequestId)();

  if (!isSignalEventIngestConfigured(env)) {
    return errorResponse(
      503,
      requestId,
      "ingest_not_configured",
      "Protected ingest is not configured.",
    );
  }

  if (!authenticateSignalEventIngest(request.headers, env)) {
    return errorResponse(401, requestId, "unauthorized", "Unauthorized.");
  }

  if (isProductionRuntime(env) && !options.sink.durable) {
    return errorResponse(
      503,
      requestId,
      "storage_not_ready",
      "Durable ingest storage is not configured.",
    );
  }

  try {
    if (!acceptsApplicationJson(request)) {
      return errorResponse(415, requestId, "unsupported_media_type", "Use application/json.");
    }

    if (requestContentLengthExceeds(request, SIGNALOPS_EVENT_LIMITS.maxBodyBytes)) {
      return errorResponse(
        413,
        requestId,
        "payload_too_large",
        `Request body must be ${SIGNALOPS_EVENT_LIMITS.maxBodyBytes} bytes or smaller.`,
      );
    }

    const bodyResult = await readBoundedRequestBody(request, SIGNALOPS_EVENT_LIMITS.maxBodyBytes);
    if (!bodyResult.ok) {
      return errorResponse(
        413,
        requestId,
        "payload_too_large",
        `Request body must be ${SIGNALOPS_EVENT_LIMITS.maxBodyBytes} bytes or smaller.`,
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(bodyResult.text);
    } catch {
      return errorResponse(400, requestId, "invalid_json", "Body must contain valid JSON.");
    }

    let batch;
    try {
      batch = normalizeSignalEventBatch(payload, {
        privacyMode: "redact",
        currentTimeMs: options.currentTimeMs,
        maxBatchEvents: SIGNALOPS_EVENT_LIMITS.maxBatchEvents,
      });
    } catch (error) {
      return errorResponse(
        422,
        requestId,
        "invalid_batch",
        error instanceof Error ? error.message : "Invalid event batch.",
      );
    }

    if (batch.events.length === 0) {
      return {
        status: 422,
        body: {
          ok: false,
          code: "invalid_event",
          error: "No valid events were accepted.",
          requestId,
          rejected: batch.rejected,
        },
      };
    }

    const writeResult = await options.sink.store(batch.events);
    const eventIds = batch.events.map((event) => event.eventId);

    if (writeResult.conflictEvents > 0) {
      return {
        status: 409,
        body: {
          ok: false,
          code: "idempotency_conflict",
          error: "An event identifier was already used for a different payload.",
          requestId,
          conflictEventRefs: writeResult.conflictEventIds.map((eventId) =>
            safeReference("evtref", eventId),
          ),
        },
      };
    }

    const receiptFingerprint = JSON.stringify({
      eventIds,
      rejected: batch.rejected,
    });

    return {
      status: 200,
      body: {
        ok: true,
        partial: batch.rejected.length > 0,
        requestId,
        receipt: {
          type: "signalops.ingest_receipt",
          receiptId: safeReference("rcpt", receiptFingerprint),
          acceptedEvents: batch.events.length,
          rejectedEvents: batch.rejected.length,
          storedEvents: writeResult.storedEvents,
          duplicateEvents: writeResult.duplicateEvents,
          evictedEvents: writeResult.evictedEvents,
          retainedEvents: writeResult.retainedEvents,
          eventRefs: eventIds.map((eventId) => safeReference("evtref", eventId)),
          storedEventRefs: writeResult.storedEventIds.map((eventId) =>
            safeReference("evtref", eventId),
          ),
          duplicateEventRefs: writeResult.duplicateEventIds.map((eventId) =>
            safeReference("evtref", eventId),
          ),
          storage: {
            adapter: options.sink.adapter,
            durable: options.sink.durable,
            capacity: options.sink.capacity,
          },
        },
        rejected: batch.rejected,
      },
    };
  } catch {
    return errorResponse(500, requestId, "internal_error", "Unexpected ingest error.");
  }
}

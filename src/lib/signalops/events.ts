export const SIGNALOPS_EVENT_LIMITS = {
  maxBodyBytes: 256 * 1024,
  maxBatchEvents: 100,
  maxStringLengths: {
    type: 64,
    occurredAt: 64,
    eventId: 160,
    generationId: 120,
    providerId: 80,
    modelId: 120,
    source: 80,
    status: 32,
    statusMessage: 240,
    user: 240,
    prompt: 2_000,
  },
} as const;

export const signalEventTypes = [
  "generation.started",
  "generation.completed",
  "generation.failed",
  "generation.retrying",
  "provider.health",
  "cost.recorded",
] as const;

export const generationStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "retrying",
  "blocked",
] as const;

export type SignalEventType = (typeof signalEventTypes)[number];
export type SignalGenerationStatus = (typeof generationStatuses)[number];
export type SignalPrivacyMode = "redact" | "raw";

export type SignalEvent = {
  eventId: string;
  type: SignalEventType;
  occurredAt: string;
  receivedAt: string;
  generationId?: string;
  providerId?: string;
  modelId?: string;
  status?: SignalGenerationStatus;
  source?: string;
  statusMessage?: string;
  durationMs?: number;
  cost?: number;
  retryCount?: number;
  user?: string;
  prompt?: string;
};

export type SignalBatchRejection = {
  index: number;
  error: string;
};

export type SignalEventBatch = {
  events: SignalEvent[];
  rejected: SignalBatchRejection[];
};

export type SignalEventDiagnostics = {
  readiness: "insufficient" | "partial" | "pilot_ready";
  coverage: {
    generationLifecycle: {
      started: boolean;
      completed: boolean;
      failed: boolean;
      retrying: boolean;
    };
    providerHealth: boolean;
    latency: boolean;
    cost: boolean;
    retries: boolean;
    providers: number;
    models: number;
  };
  gaps: string[];
  nextActions: string[];
};

export type SignalEventValidationSummary = {
  validEvents: number;
  rejectedEvents: number;
  eventTypes: SignalEventType[];
  providerIds: string[];
  modelIds: string[];
  privacyMode: "redact" | "raw";
  diagnostics: SignalEventDiagnostics;
  storedEvents: 0;
};

export type SignalEventValidationResponse = SignalEventValidationSummary & {
  ok: boolean;
  code?: string;
  error?: string;
  partial?: boolean;
  verificationOnly: true;
  storedEvents: 0;
  limits?: {
    maxBodyBytes: number;
    maxBatchEvents: number;
  };
  rejected?: SignalBatchRejection[];
  acceptedPreview?: SignalEvent[];
  requestId: string;
};

const eventTypeSet = new Set<string>(signalEventTypes);
const generationStatusSet = new Set<string>(generationStatuses);
const generationEventTypeSet = new Set<SignalEventType>([
  "generation.started",
  "generation.completed",
  "generation.failed",
  "generation.retrying",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableHash(input: string) {
  let hash = 0x811c9dc5;

  for (const char of input) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function utf8Bytes(input: string) {
  return new TextEncoder().encode(input).length;
}

function readBoundedString(
  value: unknown,
  fieldName: keyof typeof SIGNALOPS_EVENT_LIMITS.maxStringLengths,
) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.length > SIGNALOPS_EVENT_LIMITS.maxStringLengths[fieldName]) {
    throw new Error(
      `${fieldName} must be at most ${SIGNALOPS_EVENT_LIMITS.maxStringLengths[fieldName]} characters`,
    );
  }

  return trimmed;
}

function readFiniteNonNegativeNumber(
  value: unknown,
  fieldName: "durationMs" | "cost" | "retryCount",
  options: { integer?: boolean } = {},
) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${fieldName} must be a finite nonnegative number`);
  }

  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  return value;
}

function normalizeTimestamp(value: unknown, currentTimeMs: number) {
  const raw = readBoundedString(value, "occurredAt");
  if (!raw) {
    throw new Error("occurredAt is required");
  }

  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)) {
    throw new Error("occurredAt must use UTC ISO-8601 format with milliseconds");
  }

  const timestamp = new Date(raw);
  if (Number.isNaN(timestamp.getTime()) || timestamp.toISOString() !== raw) {
    throw new Error("occurredAt must be a valid ISO-8601 timestamp");
  }

  if (timestamp.getTime() > currentTimeMs) {
    throw new Error("occurredAt cannot be in the future");
  }

  return timestamp.toISOString();
}

function deriveEventId(
  explicitEventId: string | undefined,
  type: SignalEventType,
  occurredAt: string,
  generationId: string | undefined,
  providerId: string | undefined,
  modelId: string | undefined,
) {
  if (explicitEventId) {
    return explicitEventId;
  }

  if (generationId && generationEventTypeSet.has(type)) {
    return `${type}:${generationId}:${stableHash(occurredAt)}`;
  }

  return `evt_${stableHash([type, occurredAt, generationId ?? "", providerId ?? "", modelId ?? ""].join("|"))}`;
}

function uniqueSorted<T extends string>(values: Array<T | undefined>) {
  return [...new Set(values.filter((value): value is T => Boolean(value)))].sort();
}

export function getUtf8ByteLength(input: string) {
  return utf8Bytes(input);
}

export function requestContentLengthExceeds(request: Request, maxBodyBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) {
    return false;
  }

  const parsed = Number(contentLength);
  return Number.isFinite(parsed) && parsed > maxBodyBytes;
}

export function acceptsApplicationJson(request: Request) {
  const contentType = request.headers.get("content-type");
  return contentType?.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

export async function readBoundedRequestBody(
  request: Request,
  maxBodyBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = request.body;

  // Fall back to a buffered read when no stream is exposed, still enforcing the limit.
  if (!body) {
    const text = await request.text();
    return getUtf8ByteLength(text) > maxBodyBytes ? { ok: false } : { ok: true, text };
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let text = "";
  let bytes = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        return { ok: false };
      }

      // stream: true keeps multi-byte UTF-8 sequences intact across chunk boundaries.
      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
    return { ok: true, text };
  } finally {
    reader.releaseLock();
  }
}

export function normalizeSignalEvent(
  input: unknown,
  options: {
    privacyMode?: SignalPrivacyMode;
    currentTimeMs?: number;
    receivedAt?: string;
  } = {},
): SignalEvent {
  if (!isRecord(input)) {
    throw new Error("event must be an object");
  }

  const privacyMode = options.privacyMode ?? "redact";
  const currentTimeMs = options.currentTimeMs ?? Date.now();
  const receivedAt = options.receivedAt ?? new Date(currentTimeMs).toISOString();
  const type = readBoundedString(input.type, "type");

  if (!type || !eventTypeSet.has(type)) {
    throw new Error(`type must be one of ${signalEventTypes.join(", ")}`);
  }

  const normalizedType = type as SignalEventType;
  const occurredAt = normalizeTimestamp(
    input.occurredAt ?? input.timestamp ?? input.createdAt,
    currentTimeMs,
  );
  const providerId = readBoundedString(input.providerId, "providerId");
  const modelId = readBoundedString(input.modelId, "modelId");
  const explicitGenerationId = readBoundedString(input.generationId, "generationId");
  const explicitEventId = readBoundedString(input.eventId, "eventId");
  const source = readBoundedString(input.source, "source");
  const statusMessage = readBoundedString(input.statusMessage, "statusMessage");
  const durationMs = readFiniteNonNegativeNumber(input.durationMs, "durationMs");
  const cost = readFiniteNonNegativeNumber(input.cost, "cost");
  const retryCount = readFiniteNonNegativeNumber(input.retryCount, "retryCount", { integer: true });
  const rawStatus = readBoundedString(input.status, "status");

  if (rawStatus && !generationStatusSet.has(rawStatus)) {
    throw new Error(`status must be one of ${generationStatuses.join(", ")}`);
  }

  const status = rawStatus as SignalGenerationStatus | undefined;
  const generationId = explicitGenerationId;

  if (generationEventTypeSet.has(normalizedType) && (!providerId || !modelId || !generationId)) {
    throw new Error("generation events require generationId, providerId, and modelId");
  }

  if (normalizedType === "provider.health" && !providerId) {
    throw new Error("provider.health requires providerId");
  }

  if (normalizedType === "cost.recorded" && (!providerId || cost == null)) {
    throw new Error("cost.recorded requires providerId and cost");
  }

  const user = readBoundedString(input.user, "user");
  const prompt = readBoundedString(input.prompt, "prompt");

  return {
    eventId: deriveEventId(explicitEventId, normalizedType, occurredAt, generationId, providerId, modelId),
    type: normalizedType,
    occurredAt,
    receivedAt,
    generationId,
    providerId,
    modelId,
    status,
    source,
    statusMessage,
    durationMs,
    cost,
    retryCount,
    user: user ? (privacyMode === "raw" ? user : "[redacted]") : undefined,
    prompt: prompt ? (privacyMode === "raw" ? prompt : "[redacted]") : undefined,
  };
}

export function normalizeSignalEventBatch(
  input: unknown,
  options: {
    privacyMode?: SignalPrivacyMode;
    currentTimeMs?: number;
    receivedAt?: string;
    maxBatchEvents?: number;
  } = {},
): SignalEventBatch {
  const maxBatchEvents = options.maxBatchEvents ?? SIGNALOPS_EVENT_LIMITS.maxBatchEvents;
  const rawEvents = Array.isArray(input)
    ? input
    : isRecord(input) && Array.isArray(input.events)
      ? input.events
      : [input];

  if (rawEvents.length > maxBatchEvents) {
    throw new Error(`event batches are limited to ${maxBatchEvents} events`);
  }

  const events: SignalEvent[] = [];
  const rejected: SignalBatchRejection[] = [];

  rawEvents.forEach((rawEvent, index) => {
    try {
      events.push(normalizeSignalEvent(rawEvent, options));
    } catch (error) {
      rejected.push({
        index,
        error: error instanceof Error ? error.message : "invalid event",
      });
    }
  });

  return { events, rejected };
}

function summarizeDiagnostics(batch: SignalEventBatch): SignalEventDiagnostics {
  const eventTypes = new Set(batch.events.map((event) => event.type));
  const providerIds = uniqueSorted(batch.events.map((event) => event.providerId));
  const modelIds = uniqueSorted(batch.events.map((event) => event.modelId));
  const generationLifecycle = {
    started: eventTypes.has("generation.started"),
    completed: eventTypes.has("generation.completed"),
    failed: eventTypes.has("generation.failed"),
    retrying: eventTypes.has("generation.retrying"),
  };
  const coverage = {
    generationLifecycle,
    providerHealth: eventTypes.has("provider.health"),
    latency: batch.events.some((event) => typeof event.durationMs === "number"),
    cost: batch.events.some((event) => typeof event.cost === "number"),
    retries:
      generationLifecycle.retrying ||
      batch.events.some((event) => typeof event.retryCount === "number" && event.retryCount > 0),
    providers: providerIds.length,
    models: modelIds.length,
  };
  const gaps: string[] = [];

  if (batch.events.length === 0) {
    gaps.push("Send at least one valid event.");
  }
  if (!(generationLifecycle.completed || generationLifecycle.failed)) {
    gaps.push("Send generation outcome events to prove end-state coverage.");
  }
  if (!coverage.latency) {
    gaps.push("Include durationMs for latency analysis.");
  }
  if (!coverage.cost) {
    gaps.push("Include nonnegative cost telemetry for spend analysis.");
  }
  if (!coverage.retries) {
    gaps.push("Include retryCount or generation.retrying coverage for reliability analysis.");
  }
  if (!coverage.providerHealth) {
    gaps.push("Send provider.health when providers degrade or recover.");
  }
  if (coverage.providers === 0 || coverage.models === 0) {
    gaps.push("Include providerId and modelId coverage on generation events.");
  }

  const readinessScore = [
    batch.events.length > 0,
    generationLifecycle.started,
    generationLifecycle.completed || generationLifecycle.failed,
    coverage.latency,
    coverage.cost,
    coverage.retries,
    coverage.providerHealth,
    coverage.providers > 0,
    coverage.models > 0,
  ].filter(Boolean).length;

  const readiness =
    readinessScore >= 7 ? "pilot_ready" : readinessScore >= 4 ? "partial" : "insufficient";

  const nextActions =
    readiness === "pilot_ready"
      ? [
          "Add protected ingest and durable storage after the public contract is stable.",
          "Map the same provider/model IDs into the private cockpit and alerting pipeline.",
        ]
      : gaps.slice(0, 4);

  return {
    readiness,
    coverage,
    gaps,
    nextActions,
  };
}

export function summarizeSignalEventValidation(
  batch: SignalEventBatch,
  privacyMode: SignalPrivacyMode = "redact",
): SignalEventValidationSummary {
  return {
    validEvents: batch.events.length,
    rejectedEvents: batch.rejected.length,
    eventTypes: uniqueSorted(batch.events.map((event) => event.type)),
    providerIds: uniqueSorted(batch.events.map((event) => event.providerId)),
    modelIds: uniqueSorted(batch.events.map((event) => event.modelId)),
    privacyMode: privacyMode === "raw" ? "raw" : "redact",
    diagnostics: summarizeDiagnostics(batch),
    storedEvents: 0,
  };
}

function createRequestId() {
  return `req_${crypto.randomUUID()}`;
}

export function createSignalEventErrorResponse(
  status: number,
  requestId: string,
  code: string,
  error: string,
): { status: number; body: SignalEventValidationResponse } {
  return {
    status,
    body: {
      ok: false,
      code,
      error,
      requestId,
      verificationOnly: true,
      storedEvents: 0,
      validEvents: 0,
      rejectedEvents: 0,
      eventTypes: [],
      providerIds: [],
      modelIds: [],
      privacyMode: "redact",
      diagnostics: {
        readiness: "insufficient",
        coverage: {
          generationLifecycle: {
            started: false,
            completed: false,
            failed: false,
            retrying: false,
          },
          providerHealth: false,
          latency: false,
          cost: false,
          retries: false,
          providers: 0,
          models: 0,
        },
        gaps: [],
        nextActions: [],
      },
    },
  };
}

export async function validateSignalEventRequest(
  request: Request,
): Promise<{ status: number; body: SignalEventValidationResponse }> {
  const requestId = createRequestId();

  if (!acceptsApplicationJson(request)) {
    return createSignalEventErrorResponse(415, requestId, "unsupported_media_type", "Use application/json.");
  }

  if (requestContentLengthExceeds(request, SIGNALOPS_EVENT_LIMITS.maxBodyBytes)) {
    return createSignalEventErrorResponse(
      413,
      requestId,
      "payload_too_large",
      `Request body must be ${SIGNALOPS_EVENT_LIMITS.maxBodyBytes} bytes or smaller.`,
    );
  }

  const bodyResult = await readBoundedRequestBody(request, SIGNALOPS_EVENT_LIMITS.maxBodyBytes);
  if (!bodyResult.ok) {
    return createSignalEventErrorResponse(
      413,
      requestId,
      "payload_too_large",
      `Request body must be ${SIGNALOPS_EVENT_LIMITS.maxBodyBytes} bytes or smaller.`,
    );
  }

  const rawBody = bodyResult.text;

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return createSignalEventErrorResponse(400, requestId, "invalid_json", "Body must contain valid JSON.");
  }

  let batch;
  try {
    batch = normalizeSignalEventBatch(payload, {
      privacyMode: "redact",
      maxBatchEvents: SIGNALOPS_EVENT_LIMITS.maxBatchEvents,
    });
  } catch (error) {
    return createSignalEventErrorResponse(
      422,
      requestId,
      "invalid_batch",
      error instanceof Error ? error.message : "Invalid event batch.",
    );
  }

  const summary = summarizeSignalEventValidation(batch, "redact");
  const hasValidEvents = batch.events.length > 0;
  const hasRejectedEvents = batch.rejected.length > 0;

  return {
    status: hasValidEvents ? 200 : 422,
    body: {
      ok: hasValidEvents,
      verificationOnly: true,
      partial: hasValidEvents && hasRejectedEvents,
      limits: {
        maxBodyBytes: SIGNALOPS_EVENT_LIMITS.maxBodyBytes,
        maxBatchEvents: SIGNALOPS_EVENT_LIMITS.maxBatchEvents,
      },
      ...summary,
      rejected: batch.rejected,
      acceptedPreview: batch.events.slice(0, 3),
      requestId,
    },
  };
}

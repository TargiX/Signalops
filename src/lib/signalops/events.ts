export const signalEventTypes = [
  "generation.started",
  "generation.completed",
  "generation.failed",
  "generation.retrying",
  "provider.health",
  "cost.recorded",
] as const;

export type SignalEventType = (typeof signalEventTypes)[number];

export const generationStatuses = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "retrying",
  "blocked",
] as const;

export type SignalGenerationStatus = (typeof generationStatuses)[number];

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
  durationMs?: number;
  cost?: number;
  retryCount?: number;
  user?: string;
  prompt?: string;
};

export type SignalEventBatch = {
  events: SignalEvent[];
  rejected: Array<{ index: number; error: string }>;
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

const eventTypeSet = new Set<string>(signalEventTypes);
const generationStatusSet = new Set<string>(generationStatuses);
const generationTypes = new Set<SignalEventType>([
  "generation.started",
  "generation.completed",
  "generation.failed",
  "generation.retrying",
]);
const defaultMaxBatchEvents = 100;
const stringLimits = {
  eventId: 160,
  generationId: 120,
  providerId: 80,
  modelId: 120,
  source: 80,
  user: 240,
  prompt: 2000,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readOptionalString(value: unknown, fieldName?: keyof typeof stringLimits) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (fieldName && trimmed.length > stringLimits[fieldName]) {
    throw new Error(`${fieldName} must be at most ${stringLimits[fieldName]} characters`);
  }

  return trimmed;
}

function readOptionalNumber(
  value: unknown,
  fieldName: "durationMs" | "cost" | "retryCount",
  options: { min?: number; integer?: boolean } = {},
) {
  if (value == null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }

  if (options.min != null && value < options.min) {
    throw new Error(`${fieldName} must be greater than or equal to ${options.min}`);
  }

  if (options.integer && !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }

  return value;
}

function stableEventId(event: Record<string, unknown>, type: SignalEventType, generationId: string | null | undefined) {
  const explicit = readOptionalString(event.eventId, "eventId");
  if (explicit) {
    return explicit;
  }

  if (generationId && generationTypes.has(type)) {
    return `${type}:${generationId}`;
  }

  return `evt_${crypto.randomUUID()}`;
}

function normalizeTimestamp(value: unknown) {
  const raw = readOptionalString(value);
  if (!raw) {
    return new Date().toISOString();
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const maxFutureMs = Date.now() + 5 * 60 * 1000;
  if (date.getTime() > maxFutureMs) {
    return null;
  }

  return date.toISOString();
}

export function normalizeSignalEvent(input: unknown, privacyMode = "redact"): SignalEvent {
  if (!isRecord(input)) {
    throw new Error("event must be an object");
  }

  const rawType = readOptionalString(input.type);
  if (!rawType || !eventTypeSet.has(rawType)) {
    throw new Error(`type must be one of ${signalEventTypes.join(", ")}`);
  }
  const type = rawType as SignalEventType;

  const occurredAt = normalizeTimestamp(input.occurredAt ?? input.createdAt ?? input.timestamp);
  if (!occurredAt) {
    throw new Error("timestamp must be a valid ISO date and not more than 5 minutes in the future");
  }

  const providerId = readOptionalString(input.providerId, "providerId");
  const modelId = readOptionalString(input.modelId, "modelId");
  const generationId = readOptionalString(input.generationId, "generationId");
  const source = readOptionalString(input.source, "source");
  const durationMs = readOptionalNumber(input.durationMs, "durationMs", { min: 0 });
  const cost = readOptionalNumber(input.cost, "cost", { min: 0 });
  const retryCount = readOptionalNumber(input.retryCount, "retryCount", { min: 0, integer: true });
  const rawStatus = readOptionalString(input.status);
  const status = rawStatus && generationStatusSet.has(rawStatus) ? (rawStatus as SignalGenerationStatus) : undefined;

  if (rawStatus && !status) {
    throw new Error(`status must be one of ${generationStatuses.join(", ")}`);
  }

  if (generationTypes.has(type) && (!generationId || !providerId || !modelId)) {
    throw new Error("generation events require generationId, providerId, and modelId");
  }

  if (type === "provider.health" && !providerId) {
    throw new Error("provider.health requires providerId");
  }

  if (type === "cost.recorded" && (!providerId || cost == null)) {
    throw new Error("cost.recorded requires providerId and cost");
  }

  const user = readOptionalString(input.user, "user");
  const prompt = readOptionalString(input.prompt, "prompt");
  const shouldRedact = privacyMode !== "raw";

  return {
    eventId: stableEventId(input, type, generationId),
    type,
    occurredAt,
    receivedAt: new Date().toISOString(),
    generationId: generationId ?? undefined,
    providerId: providerId ?? undefined,
    modelId: modelId ?? undefined,
    status,
    source: source ?? undefined,
    durationMs: durationMs ?? undefined,
    cost: cost ?? undefined,
    retryCount: retryCount ?? undefined,
    user: shouldRedact && user ? "[redacted]" : (user ?? undefined),
    prompt: shouldRedact && prompt ? "[redacted]" : (prompt ?? undefined),
  };
}

export function normalizeSignalEventBatch(
  input: unknown,
  privacyMode = "redact",
  options: { maxBatchEvents?: number } = {},
): SignalEventBatch {
  const rawEvents = isRecord(input) && Array.isArray(input.events) ? input.events : [input];
  const events: SignalEvent[] = [];
  const rejected: SignalEventBatch["rejected"] = [];
  const maxBatchEvents = options.maxBatchEvents ?? defaultMaxBatchEvents;

  if (rawEvents.length > maxBatchEvents) {
    throw new Error(`event batches are limited to ${maxBatchEvents} events`);
  }

  rawEvents.forEach((rawEvent, index) => {
    try {
      events.push(normalizeSignalEvent(rawEvent, privacyMode));
    } catch (error) {
      rejected.push({ index, error: error instanceof Error ? error.message : "invalid event" });
    }
  });

  return { events, rejected };
}

function uniqueSorted<T extends string>(values: Array<T | undefined>) {
  return [...new Set(values.filter((value): value is T => Boolean(value)))].sort();
}

function summarizeDiagnostics(batch: SignalEventBatch): SignalEventDiagnostics {
  const events = batch.events;
  const eventTypes = new Set(events.map((event) => event.type));
  const providerIds = uniqueSorted(events.map((event) => event.providerId));
  const modelIds = uniqueSorted(events.map((event) => event.modelId));
  const generationLifecycle = {
    started: eventTypes.has("generation.started"),
    completed: eventTypes.has("generation.completed"),
    failed: eventTypes.has("generation.failed"),
    retrying: eventTypes.has("generation.retrying"),
  };
  const coverage = {
    generationLifecycle,
    providerHealth: eventTypes.has("provider.health"),
    latency: events.some((event) => typeof event.durationMs === "number"),
    cost: events.some((event) => typeof event.cost === "number") || eventTypes.has("cost.recorded"),
    retries: events.some((event) => typeof event.retryCount === "number" && event.retryCount > 0) || generationLifecycle.retrying,
    providers: providerIds.length,
    models: modelIds.length,
  };
  const gaps: string[] = [];

  if (events.length === 0) {
    gaps.push("send at least one valid source event");
  }
  if (!generationLifecycle.completed && !generationLifecycle.failed && !generationLifecycle.retrying) {
    gaps.push("send generation outcome events");
  }
  if (!coverage.latency) {
    gaps.push("include durationMs for latency analysis");
  }
  if (!coverage.cost) {
    gaps.push("include cost or cost.recorded events for spend analysis");
  }
  if (!generationLifecycle.failed && !generationLifecycle.retrying && !coverage.retries) {
    gaps.push("send failed or retrying events to prove reliability coverage");
  }
  if (!coverage.providerHealth) {
    gaps.push("send provider.health events when provider state changes");
  }

  const strongSignals = [
    events.length > 0,
    coverage.providers > 0,
    coverage.models > 0,
    generationLifecycle.completed || generationLifecycle.failed || generationLifecycle.retrying,
    coverage.latency,
    coverage.cost,
    generationLifecycle.failed || generationLifecycle.retrying || coverage.retries,
  ].filter(Boolean).length;
  const readiness =
    strongSignals >= 6
      ? "pilot_ready"
      : strongSignals >= 3
        ? "partial"
        : "insufficient";
  const nextActions =
    readiness === "pilot_ready"
      ? [
          "send the same payload to token-protected ingest after durable storage is configured",
          "confirm the first provider/model workflow for the pilot cockpit",
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
  privacyMode = "redact",
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

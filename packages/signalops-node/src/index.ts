export type SignalOpsEventType =
  | "generation.started"
  | "generation.completed"
  | "generation.failed"
  | "generation.retrying"
  | "provider.health"
  | "cost.recorded";

export type SignalOpsGenerationStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "blocked";

export type SignalOpsEvent = {
  eventId?: string;
  type: SignalOpsEventType;
  occurredAt?: string;
  generationId?: string;
  providerId?: string;
  modelId?: string;
  status?: SignalOpsGenerationStatus;
  source?: string;
  durationMs?: number;
  cost?: number;
  retryCount?: number;
  user?: string;
  prompt?: string;
};

export type SignalOpsValidationResult = {
  ok: boolean;
  verificationOnly: true;
  ingestPolicy: SignalOpsIngestPolicy;
  validEvents: number;
  rejectedEvents: number;
  eventTypes: SignalOpsEventType[];
  providerIds: string[];
  modelIds: string[];
  privacyMode: "redact" | "raw";
  diagnostics: SignalOpsDiagnostics;
  storedEvents: 0;
  rejected: Array<{ index: number; error: string }>;
  requestId: string;
};

export type SignalOpsIngestResult = {
  ok: boolean;
  accepted: number;
  storedEvents: number;
  duplicateEvents: number;
  storedEventIds: string[];
  duplicateEventIds: string[];
  receipt?: SignalOpsSourceEventReceipt;
  diagnostics: SignalOpsDiagnostics;
  rejected: Array<{ index: number; error: string }>;
  ingestPolicy: SignalOpsIngestPolicy;
  requestId: string;
};

export type SignalOpsSourceEventReceipt = {
  type: "signalops.source_event_receipt";
  requestId: string;
  workspaceSlug: string;
  acceptedEventIds: string[];
  storedEventIds: string[];
  duplicateEvents: number;
  duplicateEventIds: string[];
  storage: {
    adapter: "memory" | "cloudflare_d1" | "supabase";
    durable: boolean;
    ready: boolean;
  };
  proof: {
    demoDataIncluded: false;
    sourceOnlyReportPath: string;
    exactSourceReportPath: string | null;
    durableWrite: boolean;
    existingEventCandidate: boolean;
    firstSourceEventCandidate: boolean;
  };
  nextActions: string[];
};

export type SignalOpsSourceVerificationMode = "validation_only" | "storage_gate" | "authenticated_ingest";
export type SignalOpsSourceSetupGateCode = "ingest_storage_not_configured" | "workspace_not_configured";

export type SignalOpsSourceVerificationResult =
  | {
      ok: true;
      mode: "validation_only";
      event: SignalOpsEvent;
      validation: SignalOpsValidationResult;
      next: string;
    }
  | {
      ok: true;
      mode: "storage_gate";
      event: SignalOpsEvent;
      validation: SignalOpsValidationResult;
      ingest: {
        accepted: false;
        status: 503;
        code: SignalOpsSourceSetupGateCode;
        requestId: string | null;
      };
      next: string;
    }
  | {
      ok: true;
      mode: "authenticated_ingest";
      event: SignalOpsEvent;
      validation: SignalOpsValidationResult;
      ingest: SignalOpsIngestResult;
    };

export type SignalOpsDiagnostics = {
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

export type SignalOpsIngestPolicy = {
  maxBatchEvents: number;
  maxBodyBytes: number;
  maxBodyKb: number;
  privacyMode: "redact" | "raw";
};

export type SignalOpsClientOptions = {
  endpoint: string;
  token?: string;
  timeoutMs?: number;
  failOpen?: boolean;
  fetch?: typeof fetch;
  onTelemetryError?: (error: unknown) => void;
};

export type TrackGenerationContext = {
  generationId: string;
  providerId: string;
  modelId: string;
  source?: string;
  user?: string;
  prompt?: string;
  cost?: number;
  retryCount?: number;
};

export type SignalOpsGenerationEventInput = Omit<SignalOpsEvent, "type"> & {
  generationId: string;
  providerId: string;
  modelId: string;
};

export type SignalOpsProviderHealthInput = Omit<SignalOpsEvent, "type"> & {
  providerId: string;
};

export type SignalOpsCostInput = Omit<SignalOpsEvent, "type"> & {
  providerId: string;
  cost: number;
};

export type SignalOpsVerifySourceOptions = {
  allowStorageGate?: boolean;
};

export class SignalOpsHttpError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(message: string, options: { status: number; code?: string; requestId?: string }) {
    super(message);
    this.name = "SignalOpsHttpError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
  }
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}

export function createSignalOpsEventId(type: SignalOpsEventType, stableKey: string) {
  const key = stableKey.trim();
  if (!key) {
    throw new Error("SignalOps event id stable key is required");
  }

  const eventId = `${type}:${key}`;
  if (eventId.length > 160) {
    throw new Error("SignalOps event id must be at most 160 characters");
  }

  return eventId;
}

function eventBody(input: SignalOpsEvent | SignalOpsEvent[]) {
  return Array.isArray(input) ? { events: input } : input;
}

async function parseJsonResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return null;
  }

  return (await response.json()) as Record<string, unknown>;
}

export function createSignalOpsClient(options: SignalOpsClientOptions) {
  const endpoint = normalizeEndpoint(options.endpoint);
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const failOpen = options.failOpen ?? true;

  async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(`${endpoint}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = await parseJsonResponse(response);

      if (!response.ok) {
        throw new SignalOpsHttpError(
          typeof json?.error === "string" ? json.error : `SignalOps request failed with ${response.status}`,
          {
            status: response.status,
            code: typeof json?.code === "string" ? json.code : undefined,
            requestId: typeof json?.requestId === "string" ? json.requestId : undefined,
          },
        );
      }

      return json as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function validate(input: SignalOpsEvent | SignalOpsEvent[]) {
    return post<SignalOpsValidationResult>("/api/events/validate", eventBody(input));
  }

  async function ingest(input: SignalOpsEvent | SignalOpsEvent[]) {
    if (!options.token) {
      throw new Error("SignalOps ingest requires a token");
    }

    return post<SignalOpsIngestResult>("/api/events", eventBody(input), options.token);
  }

  async function verifySource(
    event: SignalOpsEvent,
    verifyOptions: SignalOpsVerifySourceOptions = {},
  ): Promise<SignalOpsSourceVerificationResult> {
    const validation = await validate(event);

    if (!options.token) {
      return {
        ok: true,
        mode: "validation_only",
        event,
        validation,
        next: "Set SIGNALOPS_INGEST_TOKEN to test authenticated source ingest.",
      };
    }

    try {
      const ingestResult = await ingest(event);
      return {
        ok: true,
        mode: "authenticated_ingest",
        event,
        validation,
        ingest: ingestResult,
      };
    } catch (error) {
      if (
        verifyOptions.allowStorageGate &&
        error instanceof SignalOpsHttpError &&
        error.status === 503 &&
        (error.code === "ingest_storage_not_configured" || error.code === "workspace_not_configured")
      ) {
        return {
          ok: true,
          mode: "storage_gate",
          event,
          validation,
          ingest: {
            accepted: false,
            status: error.status,
            code: error.code,
            requestId: error.requestId ?? null,
          },
          next:
            error.code === "workspace_not_configured"
              ? "A real SIGNALOPS_WORKSPACE_SLUG is required before controlled pilot source ingest."
              : "Durable storage is not connected yet; this is expected before D1/Supabase cutover.",
        };
      }

      throw error;
    }
  }

  async function trackGeneration<T>(context: TrackGenerationContext, run: () => Promise<T>) {
    const startedAt = Date.now();
    const startedEvent: SignalOpsEvent = {
      type: "generation.started",
      generationId: context.generationId,
      providerId: context.providerId,
      modelId: context.modelId,
      status: "running",
      source: context.source,
      user: context.user,
      prompt: context.prompt,
    };

    try {
      await ingest(startedEvent);
    } catch (error) {
      options.onTelemetryError?.(error);
      if (!failOpen) {
        throw error;
      }
    }

    let result: T;
    try {
      result = await run();
    } catch (error) {
      try {
        await ingest({
          type: "generation.failed",
          generationId: context.generationId,
          providerId: context.providerId,
          modelId: context.modelId,
          status: "failed",
          source: context.source,
          user: context.user,
          prompt: context.prompt,
          durationMs: Date.now() - startedAt,
          cost: context.cost,
          retryCount: context.retryCount,
        });
      } catch (telemetryError) {
        options.onTelemetryError?.(telemetryError);
      }

      throw error;
    }

    try {
      await ingest({
        type: "generation.completed",
        generationId: context.generationId,
        providerId: context.providerId,
        modelId: context.modelId,
        status: "succeeded",
        source: context.source,
        user: context.user,
        prompt: context.prompt,
        durationMs: Date.now() - startedAt,
        cost: context.cost,
        retryCount: context.retryCount,
      });
    } catch (error) {
      options.onTelemetryError?.(error);
      if (!failOpen) {
        throw error;
      }
    }

    return result;
  }

  return {
    validate,
    ingest,
    verifySource,
    trackGeneration,
    generationStarted(input: SignalOpsGenerationEventInput) {
      return ingest({ ...input, type: "generation.started" });
    },
    generationCompleted(input: SignalOpsGenerationEventInput) {
      return ingest({ ...input, type: "generation.completed" });
    },
    generationFailed(input: SignalOpsGenerationEventInput) {
      return ingest({ ...input, type: "generation.failed" });
    },
    generationRetrying(input: SignalOpsGenerationEventInput) {
      return ingest({ ...input, type: "generation.retrying" });
    },
    providerHealth(input: SignalOpsProviderHealthInput) {
      return ingest({ ...input, type: "provider.health" });
    },
    costRecorded(input: SignalOpsCostInput) {
      return ingest({ ...input, type: "cost.recorded" });
    },
  };
}

export class SignalOpsHttpError extends Error {
    status;
    code;
    requestId;
    constructor(message, options) {
        super(message);
        this.name = "SignalOpsHttpError";
        this.status = options.status;
        this.code = options.code;
        this.requestId = options.requestId;
    }
}
function normalizeEndpoint(endpoint) {
    return endpoint.endsWith("/") ? endpoint.slice(0, -1) : endpoint;
}
export function createSignalOpsEventId(type, stableKey) {
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
function eventBody(input) {
    return Array.isArray(input) ? { events: input } : input;
}
async function parseJsonResponse(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
        return null;
    }
    return (await response.json());
}
export function createSignalOpsClient(options) {
    const endpoint = normalizeEndpoint(options.endpoint);
    const fetchImpl = options.fetch ?? fetch;
    const timeoutMs = options.timeoutMs ?? 5000;
    const failOpen = options.failOpen ?? true;
    async function post(path, body, token) {
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
                throw new SignalOpsHttpError(typeof json?.error === "string" ? json.error : `SignalOps request failed with ${response.status}`, {
                    status: response.status,
                    code: typeof json?.code === "string" ? json.code : undefined,
                    requestId: typeof json?.requestId === "string" ? json.requestId : undefined,
                });
            }
            return json;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    async function validate(input) {
        return post("/api/events/validate", eventBody(input));
    }
    async function ingest(input) {
        if (!options.token) {
            throw new Error("SignalOps ingest requires a token");
        }
        return post("/api/events", eventBody(input), options.token);
    }
    async function verifySource(event, verifyOptions = {}) {
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
        }
        catch (error) {
            if (verifyOptions.allowStorageGate &&
                error instanceof SignalOpsHttpError &&
                error.status === 503 &&
                (error.code === "ingest_storage_not_configured" || error.code === "workspace_not_configured")) {
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
                    next: error.code === "workspace_not_configured"
                        ? "A real SIGNALOPS_WORKSPACE_SLUG is required before controlled pilot source ingest."
                        : "Durable storage is not connected yet; this is expected before D1/Supabase cutover.",
                };
            }
            throw error;
        }
    }
    async function trackGeneration(context, run) {
        const startedAt = Date.now();
        const startedEvent = {
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
        }
        catch (error) {
            options.onTelemetryError?.(error);
            if (!failOpen) {
                throw error;
            }
        }
        let result;
        try {
            result = await run();
        }
        catch (error) {
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
            }
            catch (telemetryError) {
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
        }
        catch (error) {
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
        generationStarted(input) {
            return ingest({ ...input, type: "generation.started" });
        },
        generationCompleted(input) {
            return ingest({ ...input, type: "generation.completed" });
        },
        generationFailed(input) {
            return ingest({ ...input, type: "generation.failed" });
        },
        generationRetrying(input) {
            return ingest({ ...input, type: "generation.retrying" });
        },
        providerHealth(input) {
            return ingest({ ...input, type: "provider.health" });
        },
        costRecorded(input) {
            return ingest({ ...input, type: "cost.recorded" });
        },
    };
}

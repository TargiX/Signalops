export type SignalOpsEventType = "generation.started" | "generation.completed" | "generation.failed" | "generation.retrying" | "provider.health" | "cost.recorded";
export type SignalOpsGenerationStatus = "queued" | "running" | "succeeded" | "failed" | "retrying" | "blocked";
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
    rejected: Array<{
        index: number;
        error: string;
    }>;
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
    rejected: Array<{
        index: number;
        error: string;
    }>;
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
export type SignalOpsSourceVerificationResult = {
    ok: true;
    mode: "validation_only";
    event: SignalOpsEvent;
    validation: SignalOpsValidationResult;
    next: string;
} | {
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
} | {
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
export declare class SignalOpsHttpError extends Error {
    readonly status: number;
    readonly code?: string;
    readonly requestId?: string;
    constructor(message: string, options: {
        status: number;
        code?: string;
        requestId?: string;
    });
}
export declare function createSignalOpsEventId(type: SignalOpsEventType, stableKey: string): string;
export declare function createSignalOpsClient(options: SignalOpsClientOptions): {
    validate: (input: SignalOpsEvent | SignalOpsEvent[]) => Promise<SignalOpsValidationResult>;
    ingest: (input: SignalOpsEvent | SignalOpsEvent[]) => Promise<SignalOpsIngestResult>;
    verifySource: (event: SignalOpsEvent, verifyOptions?: SignalOpsVerifySourceOptions) => Promise<SignalOpsSourceVerificationResult>;
    trackGeneration: <T>(context: TrackGenerationContext, run: () => Promise<T>) => Promise<T>;
    generationStarted(input: SignalOpsGenerationEventInput): Promise<SignalOpsIngestResult>;
    generationCompleted(input: SignalOpsGenerationEventInput): Promise<SignalOpsIngestResult>;
    generationFailed(input: SignalOpsGenerationEventInput): Promise<SignalOpsIngestResult>;
    generationRetrying(input: SignalOpsGenerationEventInput): Promise<SignalOpsIngestResult>;
    providerHealth(input: SignalOpsProviderHealthInput): Promise<SignalOpsIngestResult>;
    costRecorded(input: SignalOpsCostInput): Promise<SignalOpsIngestResult>;
};

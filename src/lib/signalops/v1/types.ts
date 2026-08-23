export const SIGNALOPS_V1_SCHEMA_URL =
  "https://signalops.cc/schemas/ai-telemetry/v1" as const;

export const SIGNALOPS_V1_EVENT_TYPES = [
  "com.signalops.ai.operation.accepted.v1",
  "com.signalops.ai.operation.terminal.v1",
  "com.signalops.ai.attempt.started.v1",
  "com.signalops.ai.attempt.terminal.v1",
  "com.signalops.ai.provider.probe.v1",
] as const;

export type SignalOpsEventTypeV1 = (typeof SIGNALOPS_V1_EVENT_TYPES)[number];

export const SIGNALOPS_V1_PRINCIPAL_SCOPES = ["events:validate", "events:write"] as const;

export type SignalOpsPrincipalScopeV1 = (typeof SIGNALOPS_V1_PRINCIPAL_SCOPES)[number];

export type SignalOpsTenantPrincipalV1 = Readonly<{
  tenantId: string;
  credentialId: string;
  scopes: readonly SignalOpsPrincipalScopeV1[];
}>;

export type SignalOpsOperationKindV1 =
  | "image_generation"
  | "video_generation"
  | "text_generation"
  | "embedding"
  | "transcription"
  | "training"
  | "other";

export type SignalOpsTerminalStatusV1 =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "abandoned";

export type SignalOpsFailureCategoryV1 =
  | "provider_capacity"
  | "provider_rate_limit"
  | "provider_auth"
  | "provider_rejected"
  | "provider_timeout"
  | "provider_error"
  | "content_policy"
  | "invalid_input"
  | "customer_cancelled"
  | "client_configuration"
  | "application_error"
  | "postprocessing_error"
  | "storage_error"
  | "unknown";

export type SignalOpsFailureResponsibilityV1 =
  | "provider"
  | "customer"
  | "client"
  | "platform"
  | "unknown";

export type SignalOpsCostSourceV1 =
  | "provider_reported"
  | "catalog_estimate"
  | "billing_reconciled";

export type SignalOpsAttributesV1 = Record<string, string | number | boolean>;

export type SignalOpsOperationV1 = {
  id: string;
  kind: SignalOpsOperationKindV1;
  logicalModelKey?: string;
};

export type SignalOpsAttemptV1 = {
  id: string;
  number: number;
};

export type SignalOpsRouteV1 = {
  providerKey: string;
  providerVendor?: string;
  modelKey: string;
  providerModelKey?: string;
  region?: string;
};

export type SignalOpsProbeRouteV1 = Omit<SignalOpsRouteV1, "modelKey"> & {
  modelKey?: string;
};

export type SignalOpsFailureV1 = {
  category: SignalOpsFailureCategoryV1;
  responsibility: SignalOpsFailureResponsibilityV1;
  code?: string;
  retryable?: boolean;
};

export type SignalOpsTerminalOutcomeV1 =
  | { status: "succeeded" }
  | { status: "cancelled"; failure?: SignalOpsFailureV1 }
  | {
      status: "failed" | "expired" | "abandoned";
      failure: SignalOpsFailureV1;
    };

export type SignalOpsCostV1 = {
  amount: string;
  currency: string;
  source: SignalOpsCostSourceV1;
};

export type SignalOpsResourceV1 = {
  environment: string;
  service: string;
  release?: string;
  region?: string;
};

export type SignalOpsOperationAcceptedDataV1 = {
  operation: SignalOpsOperationV1;
  resource: SignalOpsResourceV1;
  attributes?: SignalOpsAttributesV1;
};

export type SignalOpsOperationTerminalDataV1 = {
  operation: SignalOpsOperationV1;
  outcome: SignalOpsTerminalOutcomeV1;
  metrics?: {
    totalDurationMs?: number;
    attemptCount?: number;
  };
  resource: SignalOpsResourceV1;
  attributes?: SignalOpsAttributesV1;
};

export type SignalOpsAttemptStartedDataV1 = {
  operation: SignalOpsOperationV1;
  attempt: SignalOpsAttemptV1;
  route: SignalOpsRouteV1;
  resource: SignalOpsResourceV1;
  attributes?: SignalOpsAttributesV1;
};

export type SignalOpsAttemptTerminalDataV1 = {
  operation: SignalOpsOperationV1;
  attempt: SignalOpsAttemptV1;
  route: SignalOpsRouteV1;
  outcome: SignalOpsTerminalOutcomeV1;
  metrics?: {
    durationMs?: number;
    queueDurationMs?: number;
    outputUnits?: number;
  };
  cost?: SignalOpsCostV1;
  resource: SignalOpsResourceV1;
  attributes?: SignalOpsAttributesV1;
};

export type SignalOpsProviderProbeDataV1 = {
  route: SignalOpsProbeRouteV1;
  outcome:
    | { status: "succeeded" }
    | { status: "failed"; failure: SignalOpsFailureV1 };
  metrics?: { durationMs?: number };
  resource: SignalOpsResourceV1;
  attributes?: SignalOpsAttributesV1;
};

type SignalOpsEventEnvelopeV1<TType extends SignalOpsEventTypeV1, TData> = {
  specversion: "1.0";
  id: string;
  source: string;
  type: TType;
  subject: string;
  time: string;
  datacontenttype: "application/json";
  dataschema: typeof SIGNALOPS_V1_SCHEMA_URL;
  traceparent?: string;
  data: TData;
};

export type SignalOpsEventV1 =
  | SignalOpsEventEnvelopeV1<
      "com.signalops.ai.operation.accepted.v1",
      SignalOpsOperationAcceptedDataV1
    >
  | SignalOpsEventEnvelopeV1<
      "com.signalops.ai.operation.terminal.v1",
      SignalOpsOperationTerminalDataV1
    >
  | SignalOpsEventEnvelopeV1<
      "com.signalops.ai.attempt.started.v1",
      SignalOpsAttemptStartedDataV1
    >
  | SignalOpsEventEnvelopeV1<
      "com.signalops.ai.attempt.terminal.v1",
      SignalOpsAttemptTerminalDataV1
    >
  | SignalOpsEventEnvelopeV1<
      "com.signalops.ai.provider.probe.v1",
      SignalOpsProviderProbeDataV1
    >;

export type SignalOpsContractIssueV1 = {
  instancePath: string;
  keyword: string;
  message: string;
};

export type SignalOpsEventValidationResultV1 =
  | { ok: true; event: SignalOpsEventV1 }
  | { ok: false; issues: SignalOpsContractIssueV1[] };

import { createHash } from "node:crypto";

import type { SignalOpsOpsSnapshotV1 } from "./ops-snapshot.ts";
import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";

export type SignalOpsSloMetricV1 =
  | "operation_success_rate"
  | "operation_p95_duration_ms"
  | "provider_attempt_coverage"
  | "failure_classification_coverage"
  | "signal_freshness_ms";

export type SignalOpsSloComparatorV1 = "gte" | "lte";
export type SignalOpsSloEvaluationStatusV1 =
  | "met"
  | "breached"
  | "insufficient_data"
  | "disabled";

export type SignalOpsSloPolicyV1 = {
  tenantId: string;
  id: string;
  version: string;
  name: string;
  description: string;
  metric: SignalOpsSloMetricV1;
  comparator: SignalOpsSloComparatorV1;
  objective: number;
  warningThreshold: number;
  criticalThreshold: number;
  minimumSample: number;
  windowMinutes: number;
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type SignalOpsSloEvaluationV1 = {
  policy: SignalOpsSloPolicyV1;
  status: SignalOpsSloEvaluationStatusV1;
  severity: "warning" | "critical" | null;
  observedValue: number | null;
  sampleSize: number;
  evaluatedAt: string;
};

type SloPolicyRow = {
  tenant_id: string;
  id: string;
  version: string;
  name: string;
  description: string;
  metric: SignalOpsSloMetricV1;
  comparator: SignalOpsSloComparatorV1;
  objective: number;
  warning_threshold: number;
  critical_threshold: number;
  minimum_sample: number;
  window_minutes: number;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
};

type PolicyTemplate = Omit<
  SignalOpsSloPolicyV1,
  "tenantId" | "updatedAt" | "updatedBy"
>;

const DEFAULT_POLICY_TEMPLATES: readonly PolicyTemplate[] = [
  {
    id: "slo_operation_success_rate",
    version: "operation-reliability-2026-08-24",
    name: "Operation reliability",
    description: "Terminal AI operations that complete successfully.",
    metric: "operation_success_rate",
    comparator: "gte",
    objective: 0.99,
    warningThreshold: 0.98,
    criticalThreshold: 0.95,
    minimumSample: 20,
    windowMinutes: 1_440,
    enabled: true,
  },
  {
    id: "slo_operation_p95_duration",
    version: "operation-latency-2026-08-24",
    name: "Operation latency",
    description: "End-to-end p95 duration for terminal AI operations.",
    metric: "operation_p95_duration_ms",
    comparator: "lte",
    objective: 60_000,
    warningThreshold: 120_000,
    criticalThreshold: 300_000,
    minimumSample: 20,
    windowMinutes: 1_440,
    enabled: true,
  },
  {
    id: "slo_provider_attempt_coverage",
    version: "attempt-coverage-2026-08-24",
    name: "Provider attempt coverage",
    description: "Operations with explicit provider attempt telemetry.",
    metric: "provider_attempt_coverage",
    comparator: "gte",
    objective: 0.95,
    warningThreshold: 0.9,
    criticalThreshold: 0.75,
    minimumSample: 20,
    windowMinutes: 1_440,
    enabled: true,
  },
  {
    id: "slo_failure_classification_coverage",
    version: "failure-taxonomy-2026-08-24",
    name: "Failure classification coverage",
    description: "Failed operations with a normalized failure category.",
    metric: "failure_classification_coverage",
    comparator: "gte",
    objective: 0.95,
    warningThreshold: 0.9,
    criticalThreshold: 0.75,
    minimumSample: 5,
    windowMinutes: 1_440,
    enabled: true,
  },
  {
    id: "slo_signal_freshness",
    version: "signal-freshness-2026-08-24",
    name: "Signal freshness",
    description:
      "Time since the last received signal. Disabled until a tenant declares an expected traffic cadence.",
    metric: "signal_freshness_ms",
    comparator: "lte",
    objective: 5 * 60_000,
    warningThreshold: 15 * 60_000,
    criticalThreshold: 60 * 60_000,
    minimumSample: 1,
    windowMinutes: 60,
    enabled: false,
  },
] as const;

const globalSloState = globalThis as typeof globalThis & {
  __signalOpsSloPoliciesV1?: Map<string, SignalOpsSloPolicyV1>;
};
const localPolicies = globalSloState.__signalOpsSloPoliciesV1 ?? new Map();
globalSloState.__signalOpsSloPoliciesV1 = localPolicies;

export function defaultSignalOpsSloPoliciesV1(tenantId: string): SignalOpsSloPolicyV1[] {
  return DEFAULT_POLICY_TEMPLATES.map((policy) => ({
    ...policy,
    tenantId,
    updatedAt: null,
    updatedBy: null,
  }));
}

function fromRow(row: SloPolicyRow): SignalOpsSloPolicyV1 {
  return {
    tenantId: row.tenant_id,
    id: row.id,
    version: row.version,
    name: row.name,
    description: row.description,
    metric: row.metric,
    comparator: row.comparator,
    objective: Number(row.objective),
    warningThreshold: Number(row.warning_threshold),
    criticalThreshold: Number(row.critical_threshold),
    minimumSample: row.minimum_sample,
    windowMinutes: row.window_minutes,
    enabled: row.enabled,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function toRow(policy: SignalOpsSloPolicyV1): SloPolicyRow {
  return {
    tenant_id: policy.tenantId,
    id: policy.id,
    version: policy.version,
    name: policy.name,
    description: policy.description,
    metric: policy.metric,
    comparator: policy.comparator,
    objective: policy.objective,
    warning_threshold: policy.warningThreshold,
    critical_threshold: policy.criticalThreshold,
    minimum_sample: policy.minimumSample,
    window_minutes: policy.windowMinutes,
    enabled: policy.enabled,
    updated_at: policy.updatedAt ?? new Date().toISOString(),
    updated_by: policy.updatedBy,
  };
}

export async function listSignalOpsSloPoliciesV1(
  tenantId: string,
): Promise<SignalOpsSloPolicyV1[]> {
  const defaults = defaultSignalOpsSloPoliciesV1(tenantId);
  const config = getSignalOpsSupabaseConfigV1();
  let stored: SignalOpsSloPolicyV1[];
  if (!config) {
    stored = [...localPolicies.values()].filter((policy) => policy.tenantId === tenantId);
  } else {
    const filters = new URLSearchParams({
      select: "*",
      tenant_id: `eq.${tenantId}`,
      order: "id.asc",
      limit: "100",
    });
    const rows = await signalOpsSupabaseRestRequestV1<SloPolicyRow[]>(
      config,
      `signalops_v1_slo_policies?${filters}`,
    );
    stored = rows.map(fromRow);
  }

  const merged = new Map(defaults.map((policy) => [policy.id, policy]));
  for (const policy of stored) merged.set(policy.id, policy);
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function assertFiniteThreshold(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 31_536_000_000) {
    throw new Error(`invalid_${field}`);
  }
}

function validatePolicy(policy: SignalOpsSloPolicyV1): void {
  assertFiniteThreshold(policy.objective, "objective");
  assertFiniteThreshold(policy.warningThreshold, "warning_threshold");
  assertFiniteThreshold(policy.criticalThreshold, "critical_threshold");
  if (!Number.isInteger(policy.minimumSample) || policy.minimumSample < 1 || policy.minimumSample > 1_000_000) {
    throw new Error("invalid_minimum_sample");
  }
  if (!Number.isInteger(policy.windowMinutes) || policy.windowMinutes < 1 || policy.windowMinutes > 129_600) {
    throw new Error("invalid_window_minutes");
  }
  const ordered =
    policy.comparator === "gte"
      ? policy.criticalThreshold <= policy.warningThreshold &&
        policy.warningThreshold <= policy.objective
      : policy.objective <= policy.warningThreshold &&
        policy.warningThreshold <= policy.criticalThreshold;
  if (!ordered) throw new Error("invalid_threshold_order");
  if (
    policy.metric.endsWith("rate") ||
    policy.metric.endsWith("coverage")
  ) {
    if (
      policy.objective > 1 ||
      policy.warningThreshold > 1 ||
      policy.criticalThreshold > 1
    ) {
      throw new Error("invalid_ratio_threshold");
    }
  }
}

export async function updateSignalOpsSloPolicyV1(input: {
  tenantId: string;
  policyId: string;
  actorSubject: string;
  patch: Partial<
    Pick<
      SignalOpsSloPolicyV1,
      | "enabled"
      | "objective"
      | "warningThreshold"
      | "criticalThreshold"
      | "minimumSample"
    >
  >;
  now?: Date;
}): Promise<SignalOpsSloPolicyV1 | null> {
  const current = (await listSignalOpsSloPoliciesV1(input.tenantId)).find(
    (policy) => policy.id === input.policyId,
  );
  if (!current) return null;
  const updatedAt = (input.now ?? new Date()).toISOString();
  const revision = createHash("sha256")
    .update(JSON.stringify({ ...input.patch, updatedAt }))
    .digest("hex")
    .slice(0, 10);
  const policy: SignalOpsSloPolicyV1 = {
    ...current,
    ...input.patch,
    version: `tenant-policy-${updatedAt.slice(0, 10)}-${revision}`,
    updatedAt,
    updatedBy: input.actorSubject.slice(0, 200),
  };
  validatePolicy(policy);

  const config = getSignalOpsSupabaseConfigV1();
  if (!config) {
    localPolicies.set(`${policy.tenantId}:${policy.id}`, structuredClone(policy));
  } else {
    await signalOpsSupabaseRestRequestV1<null>(
      config,
      "signalops_v1_slo_policies?on_conflict=tenant_id,id",
      {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(toRow(policy)),
      },
    );
  }
  return policy;
}

function observationForPolicy(
  snapshot: SignalOpsOpsSnapshotV1,
  metric: SignalOpsSloMetricV1,
  now: Date,
): { observedValue: number | null; sampleSize: number } {
  const terminalOperations = snapshot.totals.succeeded + snapshot.totals.failed;
  if (metric === "operation_success_rate") {
    return { observedValue: snapshot.totals.successRate, sampleSize: terminalOperations };
  }
  if (metric === "operation_p95_duration_ms") {
    return {
      observedValue: snapshot.totals.p95DurationMs,
      sampleSize: snapshot.totals.operationsWithDuration,
    };
  }
  if (metric === "provider_attempt_coverage") {
    return {
      observedValue: snapshot.coverage.providerAttempts.ratio,
      sampleSize: snapshot.coverage.providerAttempts.total,
    };
  }
  if (metric === "failure_classification_coverage") {
    return {
      observedValue: snapshot.coverage.failureClassification.ratio,
      sampleSize: snapshot.coverage.failureClassification.total,
    };
  }
  const lastReceivedAt = snapshot.freshness.lastReceivedAt;
  return {
    observedValue: lastReceivedAt
      ? Math.max(0, now.getTime() - Date.parse(lastReceivedAt))
      : null,
    sampleSize: snapshot.projection.sourceEventCount > 0 ? 1 : 0,
  };
}

export function evaluateSignalOpsSloPoliciesV1(input: {
  snapshot: SignalOpsOpsSnapshotV1;
  policies: readonly SignalOpsSloPolicyV1[];
  now?: Date;
}): SignalOpsSloEvaluationV1[] {
  const now = input.now ?? new Date(input.snapshot.generatedAt);
  return input.policies.map((policy) => {
    const observation = observationForPolicy(input.snapshot, policy.metric, now);
    if (!policy.enabled) {
      return {
        policy,
        status: "disabled",
        severity: null,
        ...observation,
        evaluatedAt: now.toISOString(),
      };
    }
    if (
      observation.sampleSize < policy.minimumSample ||
      observation.observedValue === null
    ) {
      return {
        policy,
        status: "insufficient_data",
        severity: null,
        ...observation,
        evaluatedAt: now.toISOString(),
      };
    }

    const critical =
      policy.comparator === "gte"
        ? observation.observedValue < policy.criticalThreshold
        : observation.observedValue > policy.criticalThreshold;
    const warning =
      policy.comparator === "gte"
        ? observation.observedValue < policy.warningThreshold
        : observation.observedValue > policy.warningThreshold;
    return {
      policy,
      status: critical || warning ? "breached" : "met",
      severity: critical ? "critical" : warning ? "warning" : null,
      ...observation,
      evaluatedAt: now.toISOString(),
    };
  });
}

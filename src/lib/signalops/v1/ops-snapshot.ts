import type { StoredSignalOpsEventV1 } from "./event-store.ts";
import type {
  SignalOpsCostSourceV1,
  SignalOpsEventV1,
  SignalOpsFailureCategoryV1,
  SignalOpsFailureResponsibilityV1,
  SignalOpsTerminalStatusV1,
} from "./types.ts";

type OperationAcceptedEvent = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.operation.accepted.v1" }
>;

type OperationTerminalEvent = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.operation.terminal.v1" }
>;

type AttemptEvent = Extract<
  SignalOpsEventV1,
  {
    type:
      | "com.signalops.ai.attempt.started.v1"
      | "com.signalops.ai.attempt.terminal.v1";
  }
>;

type AttemptTerminalEvent = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.attempt.terminal.v1" }
>;

type NonProbeEvent = Exclude<
  SignalOpsEventV1,
  { type: "com.signalops.ai.provider.probe.v1" }
>;

export type SignalOpsOpsRangeV1 = "24h" | "7d" | "30d" | "90d";
export type SignalOpsProviderHealthV1 = "healthy" | "degraded" | "incident" | "insufficient_data";

export type SignalOpsCostTotalsV1 = Record<SignalOpsCostSourceV1, number>;

export type SignalOpsCurrencyCostV1 = SignalOpsCostTotalsV1 & {
  currency: string;
};

export type SignalOpsProviderSnapshotV1 = {
  providerKey: string;
  providerVendor?: string;
  modelKey: string;
  attempts: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  retryableFailures: number;
  p95DurationMs: number | null;
  costByCurrency: SignalOpsCurrencyCostV1[];
  health: SignalOpsProviderHealthEvaluationV1;
  // Same thresholds over the whole selected range. Display-only fallback for low-volume routes;
  // alerting keeps using the short `health` window.
  windowHealth: SignalOpsProviderHealthEvaluationV1 & { lowSample: boolean };
};

export type SignalOpsProviderHealthEvaluationV1 = {
  status: SignalOpsProviderHealthV1;
  sampleSize: number;
  failureRate: number | null;
  p95DurationMs: number | null;
  windowMinutes: number;
  policyVersion: string;
};

// "stalled" is a projection state, not a terminal outcome: accepted work with no terminal event
// after the stall threshold. It stays distinct from live "running" work.
export type SignalOpsOperationStatusV1 = SignalOpsTerminalStatusV1 | "running" | "stalled";

export type SignalOpsOperationSnapshotV1 = {
  operationId: string;
  kind: string;
  logicalModelKey?: string;
  status: SignalOpsOperationStatusV1;
  durationMs: number | null;
  attemptCount: number;
  environment: string;
  service: string;
  release?: string;
  occurredAt: string;
  failureCategory?: SignalOpsFailureCategoryV1;
  failureResponsibility?: SignalOpsFailureResponsibilityV1;
  failureCode?: string;
  failureRetryable?: boolean;
};

export type SignalOpsTimelineBucketV1 = {
  start: string;
  end: string;
  operations: number;
  failedOperations: number;
  attempts: number;
  failedAttempts: number;
  p95DurationMs: number | null;
  costByCurrency: SignalOpsCurrencyCostV1[];
};

export type SignalOpsModelSnapshotV1 = {
  modelKey: string;
  operations: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  p95DurationMs: number | null;
};

export type SignalOpsCoverageMetricV1 = {
  observed: number;
  total: number;
  ratio: number | null;
};

export type SignalOpsFailureSnapshotV1 = {
  category: SignalOpsFailureCategoryV1;
  responsibility: SignalOpsFailureResponsibilityV1;
  operations: number;
  retryableOperations: number;
};

export type SignalOpsProjectionPolicyV1 = {
  version: string;
  providerWindowMinutes: number;
  minimumProviderSample: number;
  warningFailureRate: number;
  criticalFailureRate: number;
  warningP95DurationMs: number;
  criticalP95DurationMs: number;
  stalledOperationMinutes?: number;
};

export const DEFAULT_SIGNALOPS_STALLED_OPERATION_MINUTES_V1 = 360;

export const DEFAULT_SIGNALOPS_PROJECTION_POLICY_V1: SignalOpsProjectionPolicyV1 = {
  version: "provider-health-2026-08-23",
  providerWindowMinutes: 10,
  minimumProviderSample: 20,
  warningFailureRate: 0.1,
  criticalFailureRate: 0.25,
  warningP95DurationMs: 120_000,
  criticalP95DurationMs: 300_000,
};

export type SignalOpsOpsSnapshotV1 = {
  tenant: { id: string; name: string };
  range: SignalOpsOpsRangeV1;
  generatedAt: string;
  freshness: { lastEventAt: string | null; lastReceivedAt: string | null };
  projection: {
    materialized: boolean;
    checkpointReceivedAt: string | null;
    sourceEventCount: number;
  };
  dataQuality: {
    complete: boolean;
    truncated: boolean;
    contradictoryTerminals: number;
    identityCollisions: number;
    idempotencyConflicts: number;
  };
  totals: {
    events: number;
    operations: number;
    attempts: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    stalled: number;
    failedByResponsibility: Record<SignalOpsFailureResponsibilityV1, number>;
    successRate: number | null;
    p95DurationMs: number | null;
    retryableFailures: number;
    operationsWithDuration: number;
    operationsWithAttemptTelemetry: number;
    costByCurrency: SignalOpsCurrencyCostV1[];
  };
  coverage: {
    operationAcceptance: SignalOpsCoverageMetricV1;
    operationCompletion: SignalOpsCoverageMetricV1;
    providerAttempts: SignalOpsCoverageMetricV1;
    attemptLifecycle: SignalOpsCoverageMetricV1;
    failureClassification: SignalOpsCoverageMetricV1;
    failureCodes: SignalOpsCoverageMetricV1;
    costEvidence: SignalOpsCoverageMetricV1;
    // Operations accepted before the first provider-attempt telemetry are legacy evidence; they
    // stay in totals but are excluded from attempt and failure-taxonomy coverage.
    cohort: { startsAt: string | null; excludedOperations: number };
  };
  environments: string[];
  timeline: SignalOpsTimelineBucketV1[];
  providers: SignalOpsProviderSnapshotV1[];
  models: SignalOpsModelSnapshotV1[];
  failureBreakdown: SignalOpsFailureSnapshotV1[];
  recentOperations: SignalOpsOperationSnapshotV1[];
  recentFailedOperations: SignalOpsOperationSnapshotV1[];
};

type OperationState = {
  source?: NonProbeEvent;
  accepted?: OperationAcceptedEvent;
  terminal?: OperationTerminalEvent;
  attempts: Set<string>;
};

type AttemptState = {
  operationId: string;
  started?: AttemptEvent;
  terminal?: AttemptTerminalEvent;
};

type ProviderAccumulator = Omit<
  SignalOpsProviderSnapshotV1,
  "successRate" | "p95DurationMs" | "costByCurrency" | "health" | "windowHealth"
> & {
  durations: number[];
  costs: Map<string, SignalOpsCostTotalsV1>;
  recentOutcomes: Array<{
    occurredAt: string;
    failed: boolean;
    durationMs: number | null;
    excludedFailure: boolean;
  }>;
};

type TimelineAccumulatorV1 = {
  start: string;
  end: string;
  operations: number;
  failedOperations: number;
  attempts: number;
  failedAttempts: number;
  durations: number[];
  costs: Map<string, SignalOpsCostTotalsV1>;
};

type ModelAccumulatorV1 = {
  modelKey: string;
  operations: number;
  succeeded: number;
  failed: number;
  durations: number[];
};

const providerExcludedFailures = new Set<SignalOpsFailureCategoryV1>([
  "content_policy",
  "invalid_input",
  "customer_cancelled",
  "client_configuration",
]);

export function rangeStartV1(range: SignalOpsOpsRangeV1, now = new Date()): string {
  const hours =
    range === "24h" ? 24 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 24 * 90;
  return new Date(now.getTime() - hours * 60 * 60 * 1_000).toISOString();
}

function timelineBucketCountV1(range: SignalOpsOpsRangeV1): number {
  if (range === "24h") return 24;
  if (range === "7d") return 28;
  return 30;
}

function createTimelineV1(range: SignalOpsOpsRangeV1, now: Date) {
  const startMs = Date.parse(rangeStartV1(range, now));
  const endMs = now.getTime();
  const bucketCount = timelineBucketCountV1(range);
  const bucketWidthMs = (endMs - startMs) / bucketCount;
  const buckets: TimelineAccumulatorV1[] = Array.from(
    { length: bucketCount },
    (_, index) => ({
      start: new Date(startMs + index * bucketWidthMs).toISOString(),
      end: new Date(startMs + (index + 1) * bucketWidthMs).toISOString(),
      operations: 0,
      failedOperations: 0,
      attempts: 0,
      failedAttempts: 0,
      durations: [],
      costs: new Map<string, SignalOpsCostTotalsV1>(),
    }),
  );

  return { buckets, startMs, endMs, bucketWidthMs };
}

function timelineBucketV1(
  timeline: ReturnType<typeof createTimelineV1>,
  time: string | null | undefined,
): TimelineAccumulatorV1 | null {
  if (!time) return null;
  const timestamp = Date.parse(time);
  if (
    !Number.isFinite(timestamp) ||
    timestamp < timeline.startMs ||
    timestamp > timeline.endMs
  ) {
    return null;
  }

  const index = Math.min(
    timeline.buckets.length - 1,
    Math.floor((timestamp - timeline.startMs) / timeline.bucketWidthMs),
  );
  return timeline.buckets[index] ?? null;
}

function percentile95(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

function emptyCost(): SignalOpsCostTotalsV1 {
  return { provider_reported: 0, catalog_estimate: 0, billing_reconciled: 0 };
}

function addCost(
  costs: Map<string, SignalOpsCostTotalsV1>,
  currency: string,
  source: SignalOpsCostSourceV1,
  amountText: string,
): void {
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) return;
  const totals = costs.get(currency) ?? emptyCost();
  totals[source] += amount;
  costs.set(currency, totals);
}

function costRows(costs: Map<string, SignalOpsCostTotalsV1>): SignalOpsCurrencyCostV1[] {
  return [...costs.entries()]
    .map(([currency, totals]) => ({ currency, ...totals }))
    .sort((left, right) => left.currency.localeCompare(right.currency));
}

function coverageMetric(observed: number, total: number): SignalOpsCoverageMetricV1 {
  return { observed, total, ratio: total === 0 ? null : observed / total };
}

function compareRecords(left: StoredSignalOpsEventV1, right: StoredSignalOpsEventV1): number {
  return (
    left.event.time.localeCompare(right.event.time) ||
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.event.id.localeCompare(right.event.id)
  );
}

function durationBetween(start: string | undefined, end: string): number | null {
  if (!start) return null;
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function providerHealth(
  row: ProviderAccumulator,
  now: Date,
  policy: SignalOpsProjectionPolicyV1,
  windowMinutes = policy.providerWindowMinutes,
  minimumSample = policy.minimumProviderSample,
): SignalOpsProviderHealthEvaluationV1 {
  const windowStart = now.getTime() - windowMinutes * 60 * 1_000;
  const eligible = row.recentOutcomes.filter(
    (outcome) => Date.parse(outcome.occurredAt) >= windowStart && !outcome.excludedFailure,
  );
  const durations = eligible.flatMap((outcome) =>
    outcome.durationMs === null ? [] : [outcome.durationMs],
  );
  const failed = eligible.filter((outcome) => outcome.failed).length;
  const failureRate = eligible.length === 0 ? null : failed / eligible.length;
  const p95DurationMs = percentile95(durations);
  let status: SignalOpsProviderHealthV1 = "insufficient_data";
  if (eligible.length >= minimumSample) {
    if (
      (failureRate ?? 0) >= policy.criticalFailureRate ||
      (p95DurationMs ?? 0) >= policy.criticalP95DurationMs
    ) {
      status = "incident";
    } else if (
      (failureRate ?? 0) >= policy.warningFailureRate ||
      (p95DurationMs ?? 0) >= policy.warningP95DurationMs
    ) {
      status = "degraded";
    } else {
      status = "healthy";
    }
  }
  return {
    status,
    sampleSize: eligible.length,
    failureRate,
    p95DurationMs,
    windowMinutes,
    policyVersion: policy.version,
  };
}

// The status an operator should see: the live window when it has enough traffic, otherwise the
// selected range as long as it holds at least one provider-attributable outcome.
export function effectiveProviderHealthV1(
  provider: Pick<SignalOpsProviderSnapshotV1, "health" | "windowHealth">,
): SignalOpsProviderHealthEvaluationV1 & { lowSample: boolean; live: boolean } {
  if (provider.health.status !== "insufficient_data" || !provider.windowHealth) {
    return { ...provider.health, lowSample: false, live: true };
  }
  return { ...provider.windowHealth, live: false };
}

export function isFailedOperationStatusV1(status: SignalOpsOperationStatusV1): boolean {
  return status === "failed" || status === "expired" || status === "abandoned";
}

function attemptInstrumentationStartV1(
  records: readonly StoredSignalOpsEventV1[],
  operations: ReadonlyMap<string, OperationState>,
): string | null {
  const firstAttempt = records.find(
    (record) =>
      record.event.type === "com.signalops.ai.attempt.started.v1" ||
      record.event.type === "com.signalops.ai.attempt.terminal.v1",
  )?.event;
  if (!firstAttempt || firstAttempt.type === "com.signalops.ai.provider.probe.v1") return null;
  const accepted = operations.get(firstAttempt.data.operation.id)?.accepted?.time;
  return accepted && accepted < firstAttempt.time ? accepted : firstAttempt.time;
}

export function buildSignalOpsOpsSnapshotV1(input: {
  tenantId: string;
  tenantName?: string;
  range: SignalOpsOpsRangeV1;
  records: readonly StoredSignalOpsEventV1[];
  now?: Date;
  sourceTruncated?: boolean;
  idempotencyConflictCount?: number;
  sourceEventCount?: number;
  checkpointReceivedAt?: string | null;
  materialized?: boolean;
  policy?: SignalOpsProjectionPolicyV1;
}): SignalOpsOpsSnapshotV1 {
  const now = input.now ?? new Date();
  const policy = input.policy ?? DEFAULT_SIGNALOPS_PROJECTION_POLICY_V1;
  const startMs = Date.parse(rangeStartV1(input.range, now));
  const endMs = now.getTime();
  const rangeMinutes = (endMs - startMs) / 60_000;
  const lifecycleRecords = input.records
    .filter(
      (record) =>
        record.tenantId === input.tenantId &&
        Date.parse(record.event.time) <= endMs,
    )
    .sort(compareRecords);
  const records = lifecycleRecords.filter(
    (record) => Date.parse(record.event.time) >= startMs,
  );
  const operations = new Map<string, OperationState>();
  const attempts = new Map<string, AttemptState>();
  const attemptIdentity = new Map<string, string>();
  const operationIdentity = new Map<string, string>();
  const probes: Extract<SignalOpsEventV1, { type: "com.signalops.ai.provider.probe.v1" }>[] = [];
  const environments = new Set(
    records.map((record) => record.event.data.resource.environment),
  );
  let contradictoryTerminals = 0;
  let identityCollisions = 0;

  for (const record of lifecycleRecords) {
    const { event } = record;
    const eventInRange = Date.parse(event.time) >= startMs;
    if (event.type === "com.signalops.ai.provider.probe.v1") {
      if (eventInRange) probes.push(event);
      continue;
    }

    const operationId = event.data.operation.id;
    const operationSignature = `${event.data.operation.kind}\u0000${event.data.operation.logicalModelKey ?? ""}`;
    const knownOperationSignature = operationIdentity.get(operationId);
    if (knownOperationSignature && knownOperationSignature !== operationSignature) {
      if (eventInRange) identityCollisions += 1;
      continue;
    }
    operationIdentity.set(operationId, operationSignature);

    if (
      event.type === "com.signalops.ai.attempt.started.v1" ||
      event.type === "com.signalops.ai.attempt.terminal.v1"
    ) {
      const attemptSignature = [
        operationId,
        event.data.route.providerKey,
        event.data.route.modelKey,
      ].join("\u0000");
      const knownAttemptSignature = attemptIdentity.get(event.data.attempt.id);
      if (knownAttemptSignature && knownAttemptSignature !== attemptSignature) {
        if (eventInRange) identityCollisions += 1;
        continue;
      }
      attemptIdentity.set(event.data.attempt.id, attemptSignature);
    }

    const operation = operations.get(operationId) ?? { attempts: new Set<string>() };
    operation.source ??= event;
    if (event.type === "com.signalops.ai.operation.accepted.v1") {
      operation.accepted ??= event;
    } else if (event.type === "com.signalops.ai.operation.terminal.v1") {
      if (operation.terminal) {
        if (eventInRange) contradictoryTerminals += 1;
      } else {
        operation.terminal ??= event;
      }
    } else {
      const key = `${operationId}:${event.data.attempt.id}`;
      const attempt = attempts.get(key) ?? { operationId };
      operation.attempts.add(key);
      if (event.type === "com.signalops.ai.attempt.started.v1") {
        attempt.started ??= event;
      } else if (attempt.terminal) {
        if (eventInRange) contradictoryTerminals += 1;
      } else {
        attempt.terminal ??= event;
      }
      attempts.set(key, attempt);
    }
    operations.set(operationId, operation);
  }

  const providerRows = new Map<string, ProviderAccumulator>();
  const totalCosts = new Map<string, SignalOpsCostTotalsV1>();
  const timelineState = createTimelineV1(input.range, now);
  const modelAccumulators = new Map<string, ModelAccumulatorV1>();
  const failureAccumulators = new Map<string, SignalOpsFailureSnapshotV1>();
  let includedAttempts = 0;
  let pairedAttempts = 0;
  let terminalAttempts = 0;
  let costedTerminalAttempts = 0;
  let retryableFailures = 0;
  for (const attempt of attempts.values()) {
    const event = attempt.terminal;
    const bucket = timelineBucketV1(
      timelineState,
      attempt.started?.time ?? event?.time,
    );
    if (!bucket) continue;
    includedAttempts += 1;
    if (attempt.started && attempt.terminal) pairedAttempts += 1;
    bucket.attempts += 1;
    if (!event) continue;
    terminalAttempts += 1;
    const providerId = `${event.data.route.providerKey}:${event.data.route.modelKey}`;
    const row = providerRows.get(providerId) ?? {
      providerKey: event.data.route.providerKey,
      providerVendor: event.data.route.providerVendor,
      modelKey: event.data.route.modelKey,
      attempts: 0,
      succeeded: 0,
      failed: 0,
      retryableFailures: 0,
      durations: [],
      costs: new Map<string, SignalOpsCostTotalsV1>(),
      recentOutcomes: [],
    };
    row.attempts += 1;
    const succeeded = event.data.outcome.status === "succeeded";
    const cancelledAttempt = event.data.outcome.status === "cancelled";
    if (succeeded) row.succeeded += 1;
    else if (!cancelledAttempt) row.failed += 1;
    if (!succeeded && !cancelledAttempt) bucket.failedAttempts += 1;
    const failure =
      event.data.outcome.status === "failed" ? event.data.outcome.failure : undefined;
    if (failure?.retryable) {
      row.retryableFailures += 1;
      retryableFailures += 1;
    }
    const durationMs =
      event.data.metrics?.durationMs ?? durationBetween(attempt.started?.time, event.time);
    if (durationMs !== null) row.durations.push(durationMs);
    if (event.data.cost) {
      costedTerminalAttempts += 1;
      addCost(row.costs, event.data.cost.currency, event.data.cost.source, event.data.cost.amount);
      addCost(totalCosts, event.data.cost.currency, event.data.cost.source, event.data.cost.amount);
      addCost(
        bucket.costs,
        event.data.cost.currency,
        event.data.cost.source,
        event.data.cost.amount,
      );
    }
    row.recentOutcomes.push({
      occurredAt: event.time,
      failed: !succeeded,
      durationMs,
      excludedFailure:
        cancelledAttempt || Boolean(failure && providerExcludedFailures.has(failure.category)),
    });
    providerRows.set(providerId, row);
  }

  for (const event of probes) {
    const modelKey = event.data.route.modelKey ?? "*";
    const providerId = `${event.data.route.providerKey}:${modelKey}`;
    const row = providerRows.get(providerId) ?? {
      providerKey: event.data.route.providerKey,
      providerVendor: event.data.route.providerVendor,
      modelKey,
      attempts: 0,
      succeeded: 0,
      failed: 0,
      retryableFailures: 0,
      durations: [],
      costs: new Map<string, SignalOpsCostTotalsV1>(),
      recentOutcomes: [],
    };
    row.recentOutcomes.push({
      occurredAt: event.time,
      failed: event.data.outcome.status === "failed",
      durationMs: event.data.metrics?.durationMs ?? null,
      excludedFailure: false,
    });
    providerRows.set(providerId, row);
  }

  const providers = [...providerRows.values()]
    .map((row): SignalOpsProviderSnapshotV1 => {
      const windowHealth = providerHealth(row, now, policy, rangeMinutes, 1);
      return {
      providerKey: row.providerKey,
      providerVendor: row.providerVendor,
      modelKey: row.modelKey,
      attempts: row.attempts,
      succeeded: row.succeeded,
      failed: row.failed,
      successRate:
        row.succeeded + row.failed === 0 ? null : row.succeeded / (row.succeeded + row.failed),
      retryableFailures: row.retryableFailures,
      p95DurationMs: percentile95(row.durations),
      costByCurrency: costRows(row.costs),
      health: providerHealth(row, now, policy),
      windowHealth: {
        ...windowHealth,
        lowSample: windowHealth.sampleSize < policy.minimumProviderSample,
      },
      };
    })
    .sort(
      (left, right) =>
        right.attempts - left.attempts ||
        left.providerKey.localeCompare(right.providerKey) ||
        left.modelKey.localeCompare(right.modelKey),
    );

  let succeededOperations = 0;
  let failedOperations = 0;
  let cancelledOperations = 0;
  let stalledOperations = 0;
  let acceptedOperations = 0;
  let operationsWithAttemptTelemetry = 0;
  const failedByResponsibility: Record<SignalOpsFailureResponsibilityV1, number> = {
    provider: 0,
    platform: 0,
    client: 0,
    customer: 0,
    unknown: 0,
  };
  const stalledBeforeMs =
    now.getTime() -
    (policy.stalledOperationMinutes ?? DEFAULT_SIGNALOPS_STALLED_OPERATION_MINUTES_V1) * 60_000;
  const cohortStartsAt = attemptInstrumentationStartV1(lifecycleRecords, operations);
  const cohort = {
    operations: 0,
    excluded: 0,
    withAttempts: 0,
    failed: 0,
    classified: 0,
    coded: 0,
  };
  const operationDurations: number[] = [];
  const recentOperations = [...operations.entries()]
    .flatMap(([operationId, state]): SignalOpsOperationSnapshotV1[] => {
      const event = state.terminal ?? state.accepted ?? state.source;
      if (!event) throw new Error(`operation ${operationId} has no lifecycle event`);
      const terminal = state.terminal;
      const explicitDuration = terminal?.data.metrics?.totalDurationMs;
      const durationMs = terminal
        ? explicitDuration ?? durationBetween(state.accepted?.time, terminal.time)
        : null;
      const startedAt = state.accepted?.time ?? state.source?.time ?? event.time;
      const operationBucket = timelineBucketV1(timelineState, startedAt);
      if (!operationBucket) return [];
      const status: SignalOpsOperationStatusV1 = terminal
        ? terminal.data.outcome.status
        : Date.parse(startedAt) <= stalledBeforeMs
          ? "stalled"
          : "running";
      const failed = isFailedOperationStatusV1(status);
      const inCohort = !cohortStartsAt || startedAt >= cohortStartsAt;
      if (state.accepted) acceptedOperations += 1;
      if (state.attempts.size > 0) operationsWithAttemptTelemetry += 1;
      if (inCohort) {
        cohort.operations += 1;
        if (state.attempts.size > 0) cohort.withAttempts += 1;
      } else {
        cohort.excluded += 1;
      }
      if (status === "succeeded") succeededOperations += 1;
      else if (status === "cancelled") cancelledOperations += 1;
      else if (status === "stalled") stalledOperations += 1;
      else if (failed) failedOperations += 1;
      if (durationMs !== null) operationDurations.push(durationMs);
      operationBucket.operations += 1;
      if (failed) operationBucket.failedOperations += 1;
      if (durationMs !== null) operationBucket.durations.push(durationMs);

      const modelKey =
        event.data.operation.logicalModelKey ?? event.data.operation.kind;
      const model = modelAccumulators.get(modelKey) ?? {
        modelKey,
        operations: 0,
        succeeded: 0,
        failed: 0,
        durations: [],
      };
      model.operations += 1;
      if (status === "succeeded") model.succeeded += 1;
      else if (failed) model.failed += 1;
      if (durationMs !== null) model.durations.push(durationMs);
      modelAccumulators.set(modelKey, model);

      const failure =
        terminal && terminal.data.outcome.status !== "succeeded"
          ? terminal.data.outcome.failure
          : undefined;
      if (failed) {
        const category = failure?.category ?? "unknown";
        const responsibility = failure?.responsibility ?? "unknown";
        failedByResponsibility[responsibility] += 1;
        if (inCohort) {
          cohort.failed += 1;
          if (category !== "unknown") cohort.classified += 1;
          if (failure?.code) cohort.coded += 1;
        }
        const failureKey = `${category}\u0000${responsibility}`;
        const failureRow = failureAccumulators.get(failureKey) ?? {
          category,
          responsibility,
          operations: 0,
          retryableOperations: 0,
        };
        failureRow.operations += 1;
        if (failure?.retryable) failureRow.retryableOperations += 1;
        failureAccumulators.set(failureKey, failureRow);
      }

      return [{
        operationId,
        kind: event.data.operation.kind,
        logicalModelKey: event.data.operation.logicalModelKey,
        status,
        durationMs,
        attemptCount: terminal?.data.metrics?.attemptCount ?? state.attempts.size,
        environment: event.data.resource.environment,
        service: event.data.resource.service,
        release: event.data.resource.release,
        occurredAt: terminal?.time ?? state.accepted?.time ?? event.time,
        failureCategory: failure?.category,
        failureResponsibility: failure?.responsibility,
        failureCode: failure?.code,
        failureRetryable: failure?.retryable,
      }];
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));

  const lastEventAt = records.at(-1)?.event.time ?? null;
  const lastReceivedAt = records.reduce<string | null>(
    (latest, record) => (!latest || record.receivedAt > latest ? record.receivedAt : latest),
    null,
  );
  const decidedOperations = succeededOperations + failedOperations;
  const truncated = input.sourceTruncated ?? false;
  const idempotencyConflicts = input.idempotencyConflictCount ?? 0;
  const timeline: SignalOpsTimelineBucketV1[] = timelineState.buckets.map(
    (bucket) => ({
      start: bucket.start,
      end: bucket.end,
      operations: bucket.operations,
      failedOperations: bucket.failedOperations,
      attempts: bucket.attempts,
      failedAttempts: bucket.failedAttempts,
      p95DurationMs: percentile95(bucket.durations),
      costByCurrency: costRows(bucket.costs),
    }),
  );
  const models: SignalOpsModelSnapshotV1[] = [...modelAccumulators.values()]
    .map((model) => ({
      modelKey: model.modelKey,
      operations: model.operations,
      succeeded: model.succeeded,
      failed: model.failed,
      successRate:
        model.succeeded + model.failed === 0
          ? null
          : model.succeeded / (model.succeeded + model.failed),
      p95DurationMs: percentile95(model.durations),
    }))
    .sort(
      (left, right) =>
        right.operations - left.operations ||
        left.modelKey.localeCompare(right.modelKey),
    );
  const failureBreakdown = [...failureAccumulators.values()].sort(
    (left, right) =>
      right.operations - left.operations ||
      left.category.localeCompare(right.category) ||
      left.responsibility.localeCompare(right.responsibility),
  );

  return {
    tenant: { id: input.tenantId, name: input.tenantName ?? input.tenantId },
    range: input.range,
    generatedAt: now.toISOString(),
    freshness: { lastEventAt, lastReceivedAt },
    projection: {
      materialized: input.materialized ?? false,
      checkpointReceivedAt: input.checkpointReceivedAt ?? lastReceivedAt,
      sourceEventCount: input.sourceEventCount ?? lifecycleRecords.length,
    },
    dataQuality: {
      complete:
        !truncated &&
        contradictoryTerminals === 0 &&
        identityCollisions === 0 &&
        idempotencyConflicts === 0,
      truncated,
      contradictoryTerminals,
      identityCollisions,
      idempotencyConflicts,
    },
    totals: {
      events: records.length,
      operations: recentOperations.length,
      attempts: includedAttempts,
      succeeded: succeededOperations,
      failed: failedOperations,
      cancelled: cancelledOperations,
      stalled: stalledOperations,
      failedByResponsibility,
      successRate:
        decidedOperations === 0 ? null : succeededOperations / decidedOperations,
      p95DurationMs: percentile95(operationDurations),
      retryableFailures,
      operationsWithDuration: operationDurations.length,
      operationsWithAttemptTelemetry,
      costByCurrency: costRows(totalCosts),
    },
    coverage: {
      operationAcceptance: coverageMetric(acceptedOperations, recentOperations.length),
      operationCompletion: coverageMetric(
        decidedOperations + cancelledOperations,
        recentOperations.length,
      ),
      providerAttempts: coverageMetric(cohort.withAttempts, cohort.operations),
      attemptLifecycle: coverageMetric(pairedAttempts, includedAttempts),
      failureClassification: coverageMetric(cohort.classified, cohort.failed),
      failureCodes: coverageMetric(cohort.coded, cohort.failed),
      costEvidence: coverageMetric(costedTerminalAttempts, terminalAttempts),
      cohort: { startsAt: cohortStartsAt, excludedOperations: cohort.excluded },
    },
    environments: [...environments].sort(),
    timeline,
    providers,
    models,
    failureBreakdown,
    recentOperations: recentOperations.slice(0, 50),
    recentFailedOperations: recentOperations
      .filter((operation) => isFailedOperationStatusV1(operation.status))
      .slice(0, 50),
  };
}

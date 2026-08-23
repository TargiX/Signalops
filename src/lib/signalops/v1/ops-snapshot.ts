import type { StoredSignalOpsEventV1 } from "./event-store.ts";
import type {
  SignalOpsCostSourceV1,
  SignalOpsEventV1,
  SignalOpsTerminalStatusV1,
} from "./types.ts";

type SignalOpsOperationEventV1 = Extract<
  SignalOpsEventV1,
  {
    type:
      | "com.signalops.ai.operation.accepted.v1"
      | "com.signalops.ai.operation.terminal.v1";
  }
>;

export type SignalOpsOpsRangeV1 = "24h" | "7d" | "30d" | "90d";

export type SignalOpsCostTotalsV1 = Record<SignalOpsCostSourceV1, number>;

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
  cost: SignalOpsCostTotalsV1;
};

export type SignalOpsOperationSnapshotV1 = {
  operationId: string;
  kind: string;
  logicalModelKey?: string;
  status: SignalOpsTerminalStatusV1 | "running";
  durationMs: number | null;
  attemptCount: number | null;
  environment: string;
  service: string;
  release?: string;
  occurredAt: string;
};

export type SignalOpsOpsSnapshotV1 = {
  tenant: { id: string; name: string };
  range: SignalOpsOpsRangeV1;
  generatedAt: string;
  freshness: { lastEventAt: string | null; lastReceivedAt: string | null };
  totals: {
    events: number;
    operations: number;
    attempts: number;
    succeeded: number;
    failed: number;
    successRate: number | null;
    p95DurationMs: number | null;
    retryableFailures: number;
    cost: SignalOpsCostTotalsV1;
  };
  environments: string[];
  providers: SignalOpsProviderSnapshotV1[];
  recentOperations: SignalOpsOperationSnapshotV1[];
};

export function rangeStartV1(range: SignalOpsOpsRangeV1, now = new Date()): string {
  const hours =
    range === "24h" ? 24 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 24 * 90;
  return new Date(now.getTime() - hours * 60 * 60 * 1_000).toISOString();
}

function percentile95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? null;
}

function emptyCost(): SignalOpsCostTotalsV1 {
  return {
    provider_reported: 0,
    catalog_estimate: 0,
    billing_reconciled: 0,
  };
}

function terminalStatus(event: SignalOpsEventV1): SignalOpsTerminalStatusV1 | null {
  if (
    event.type === "com.signalops.ai.operation.terminal.v1" ||
    event.type === "com.signalops.ai.attempt.terminal.v1"
  ) {
    return event.data.outcome.status;
  }
  return null;
}

export function buildSignalOpsOpsSnapshotV1(input: {
  tenantId: string;
  tenantName?: string;
  range: SignalOpsOpsRangeV1;
  records: readonly StoredSignalOpsEventV1[];
  now?: Date;
}): SignalOpsOpsSnapshotV1 {
  const now = input.now ?? new Date();
  const startMs = Date.parse(rangeStartV1(input.range, now));
  const records = input.records.filter(
    (record) =>
      record.tenantId === input.tenantId && Date.parse(record.event.time) >= startMs,
  );
  const operationEvents = new Map<string, SignalOpsOperationEventV1>();
  const acceptedOperations = new Map<string, SignalOpsOperationEventV1>();
  const providerRows = new Map<string, SignalOpsProviderSnapshotV1 & { durations: number[] }>();
  const environments = new Set<string>();
  const totalCost = emptyCost();
  const operationDurations: number[] = [];
  let attempts = 0;
  let succeeded = 0;
  let failed = 0;
  let retryableFailures = 0;

  for (const record of records) {
    const { event } = record;
    environments.add(event.data.resource.environment);

    if (event.type === "com.signalops.ai.operation.accepted.v1") {
      acceptedOperations.set(event.data.operation.id, event);
    }

    if (event.type === "com.signalops.ai.operation.terminal.v1") {
      operationEvents.set(event.data.operation.id, event);
      if (event.data.outcome.status === "succeeded") succeeded += 1;
      if (event.data.outcome.status === "failed") failed += 1;
      if (typeof event.data.metrics?.totalDurationMs === "number") {
        operationDurations.push(event.data.metrics.totalDurationMs);
      }
    }

    if (event.type !== "com.signalops.ai.attempt.terminal.v1") continue;
    attempts += 1;
    const providerKey = `${event.data.route.providerKey}:${event.data.route.modelKey}`;
    const row = providerRows.get(providerKey) ?? {
      providerKey: event.data.route.providerKey,
      providerVendor: event.data.route.providerVendor,
      modelKey: event.data.route.modelKey,
      attempts: 0,
      succeeded: 0,
      failed: 0,
      successRate: null,
      retryableFailures: 0,
      p95DurationMs: null,
      cost: emptyCost(),
      durations: [],
    };
    row.attempts += 1;
    if (event.data.outcome.status === "succeeded") row.succeeded += 1;
    if (event.data.outcome.status === "failed") row.failed += 1;
    if (event.data.outcome.status !== "succeeded" && event.data.outcome.failure?.retryable) {
      row.retryableFailures += 1;
      retryableFailures += 1;
    }
    if (typeof event.data.metrics?.durationMs === "number") {
      row.durations.push(event.data.metrics.durationMs);
    }
    if (event.data.cost) {
      const amount = Number(event.data.cost.amount);
      if (Number.isFinite(amount)) {
        row.cost[event.data.cost.source] += amount;
        totalCost[event.data.cost.source] += amount;
      }
    }
    providerRows.set(providerKey, row);
  }

  const providers = [...providerRows.values()]
    .map(({ durations, ...row }) => ({
      ...row,
      successRate: row.attempts === 0 ? null : row.succeeded / row.attempts,
      p95DurationMs: percentile95(durations),
    }))
    .sort((left, right) => right.attempts - left.attempts || left.providerKey.localeCompare(right.providerKey));

  const recentOperationEvents = new Map(acceptedOperations);
  for (const [operationId, event] of operationEvents) recentOperationEvents.set(operationId, event);

  const recentOperations = [...recentOperationEvents.values()]
    .map((event): SignalOpsOperationSnapshotV1 => {
      const terminal = event.type === "com.signalops.ai.operation.terminal.v1";
      return {
        operationId: event.data.operation.id,
        kind: event.data.operation.kind,
        logicalModelKey: event.data.operation.logicalModelKey,
        status: terminal ? (terminalStatus(event) ?? "running") : "running",
        durationMs: terminal ? (event.data.metrics?.totalDurationMs ?? null) : null,
        attemptCount: terminal ? (event.data.metrics?.attemptCount ?? null) : null,
        environment: event.data.resource.environment,
        service: event.data.resource.service,
        release: event.data.resource.release,
        occurredAt: event.time,
      };
    })
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 50);

  const lastByEventTime = records.reduce<string | null>(
    (latest, record) => (!latest || record.event.time > latest ? record.event.time : latest),
    null,
  );
  const lastByReceivedTime = records.reduce<string | null>(
    (latest, record) => (!latest || record.receivedAt > latest ? record.receivedAt : latest),
    null,
  );
  const terminalOperations = operationEvents.size;

  return {
    tenant: { id: input.tenantId, name: input.tenantName ?? input.tenantId },
    range: input.range,
    generatedAt: now.toISOString(),
    freshness: { lastEventAt: lastByEventTime, lastReceivedAt: lastByReceivedTime },
    totals: {
      events: records.length,
      operations: new Set([...acceptedOperations.keys(), ...operationEvents.keys()]).size,
      attempts,
      succeeded,
      failed,
      successRate: terminalOperations === 0 ? null : succeeded / terminalOperations,
      p95DurationMs: percentile95(operationDurations),
      retryableFailures,
      cost: totalCost,
    },
    environments: [...environments].sort(),
    providers,
    recentOperations,
  };
}

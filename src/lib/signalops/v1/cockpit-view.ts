import type {
  SignalOpsModelSnapshotV1,
  SignalOpsOperationSnapshotV1,
  SignalOpsOpsRangeV1,
  SignalOpsOpsSnapshotV1,
  SignalOpsProviderSnapshotV1,
  SignalOpsTimelineBucketV1,
} from "./ops-snapshot.ts";

const SIGNALOPS_COCKPIT_RANGES_V1 = new Set<SignalOpsOpsRangeV1>([
  "24h",
  "7d",
  "30d",
  "90d",
]);

export type SignalOpsOperationFilterV1 =
  | "all"
  | "succeeded"
  | "failed"
  | "running";

export type SignalOpsOperationSortV1 =
  | "newest"
  | "slowest"
  | "attempts"
  | "attention";

export type SignalOpsOperationTriageV1 =
  | "all"
  | "retryable"
  | "unclassified"
  | "missing_attempts"
  | "multiple_attempts"
  | "slow";

export type SignalOpsModelSortV1 =
  | "volume"
  | "failures"
  | "latency"
  | "name";

export type SignalOpsProviderSortV1 =
  | "attention"
  | "attempts"
  | "latency"
  | "name";

export type SignalOpsCockpitViewV1 = {
  range: SignalOpsOpsRangeV1;
  status: SignalOpsOperationFilterV1;
  model: string | null;
  failure: string | null;
  kind: string | null;
  service: string | null;
  environment: string | null;
  release: string | null;
  triage: SignalOpsOperationTriageV1;
  sort: SignalOpsOperationSortV1;
  operationId: string | null;
};

export type SignalOpsOperationQueryV1 = Pick<
  SignalOpsCockpitViewV1,
  | "status"
  | "model"
  | "failure"
  | "kind"
  | "service"
  | "environment"
  | "release"
  | "triage"
  | "sort"
> & {
  query: string;
  slowThresholdMs: number | null;
};

export type SignalOpsSavedCockpitViewV1 = {
  id: string;
  name: string;
  createdAt: string;
  view: SignalOpsCockpitViewV1;
};

export type SignalOpsTimelinePulseV1 = {
  earlier: {
    operations: number;
    failedOperations: number;
    attempts: number;
    failureRate: number | null;
  };
  recent: {
    operations: number;
    failedOperations: number;
    attempts: number;
    failureRate: number | null;
  };
  operationDeltaRatio: number | null;
  failureRateDelta: number | null;
  peaks: {
    volume: SignalOpsTimelineBucketV1 | null;
    failureRate: SignalOpsTimelineBucketV1 | null;
    latency: SignalOpsTimelineBucketV1 | null;
  };
};

const SIGNALOPS_COCKPIT_FILTERS_V1 = new Set<SignalOpsOperationFilterV1>([
  "all",
  "succeeded",
  "failed",
  "running",
]);

const SIGNALOPS_COCKPIT_SORTS_V1 = new Set<SignalOpsOperationSortV1>([
  "newest",
  "slowest",
  "attempts",
  "attention",
]);

const SIGNALOPS_COCKPIT_TRIAGE_V1 = new Set<SignalOpsOperationTriageV1>([
  "all",
  "retryable",
  "unclassified",
  "missing_attempts",
  "multiple_attempts",
  "slow",
]);

const MAX_COCKPIT_DIMENSION_LENGTH_V1 = 160;
const MAX_COCKPIT_OPERATION_ID_LENGTH_V1 = 256;
const MAX_SAVED_COCKPIT_VIEWS_V1 = 12;
const MAX_SAVED_COCKPIT_VIEW_NAME_LENGTH_V1 = 60;

function readSafeCockpitValueV1(
  params: URLSearchParams,
  key: string,
  maxLength: number,
): string | null {
  const value = params.get(key)?.trim();
  if (
    !value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

export function readSignalOpsCockpitRangeV1(
  search: string,
  fallback: SignalOpsOpsRangeV1 = "90d",
): SignalOpsOpsRangeV1 {
  const value = new URLSearchParams(search).get("range");
  return SIGNALOPS_COCKPIT_RANGES_V1.has(value as SignalOpsOpsRangeV1)
    ? (value as SignalOpsOpsRangeV1)
    : fallback;
}

export function applySignalOpsCockpitRangeV1(
  currentUrl: URL,
  range: SignalOpsOpsRangeV1,
): URL {
  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set("range", range);
  return nextUrl;
}

export function readSignalOpsCockpitViewV1(
  search: string,
  fallbackRange: SignalOpsOpsRangeV1 = "90d",
): SignalOpsCockpitViewV1 {
  const params = new URLSearchParams(search);
  const statusValue = params.get("status");
  const sortValue = params.get("sort");
  const triageValue = params.get("triage");
  return {
    range: readSignalOpsCockpitRangeV1(search, fallbackRange),
    status: SIGNALOPS_COCKPIT_FILTERS_V1.has(
      statusValue as SignalOpsOperationFilterV1,
    )
      ? (statusValue as SignalOpsOperationFilterV1)
      : "all",
    model: readSafeCockpitValueV1(
      params,
      "model",
      MAX_COCKPIT_DIMENSION_LENGTH_V1,
    ),
    failure: readSafeCockpitValueV1(
      params,
      "failure",
      MAX_COCKPIT_DIMENSION_LENGTH_V1,
    ),
    kind: readSafeCockpitValueV1(
      params,
      "kind",
      MAX_COCKPIT_DIMENSION_LENGTH_V1,
    ),
    service: readSafeCockpitValueV1(
      params,
      "service",
      MAX_COCKPIT_DIMENSION_LENGTH_V1,
    ),
    environment: readSafeCockpitValueV1(
      params,
      "environment",
      MAX_COCKPIT_DIMENSION_LENGTH_V1,
    ),
    release: readSafeCockpitValueV1(
      params,
      "release",
      MAX_COCKPIT_DIMENSION_LENGTH_V1,
    ),
    triage: SIGNALOPS_COCKPIT_TRIAGE_V1.has(
      triageValue as SignalOpsOperationTriageV1,
    )
      ? (triageValue as SignalOpsOperationTriageV1)
      : "all",
    sort: SIGNALOPS_COCKPIT_SORTS_V1.has(
      sortValue as SignalOpsOperationSortV1,
    )
      ? (sortValue as SignalOpsOperationSortV1)
      : "newest",
    operationId: readSafeCockpitValueV1(
      params,
      "operation",
      MAX_COCKPIT_OPERATION_ID_LENGTH_V1,
    ),
  };
}

function setOptionalCockpitParamV1(
  params: URLSearchParams,
  key: string,
  value: string | null,
): void {
  if (value) {
    params.set(key, value);
  } else {
    params.delete(key);
  }
}

export function applySignalOpsCockpitViewV1(
  currentUrl: URL,
  view: SignalOpsCockpitViewV1,
): URL {
  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set("range", view.range);
  setOptionalCockpitParamV1(
    nextUrl.searchParams,
    "status",
    view.status === "all" ? null : view.status,
  );
  setOptionalCockpitParamV1(nextUrl.searchParams, "model", view.model);
  setOptionalCockpitParamV1(nextUrl.searchParams, "failure", view.failure);
  setOptionalCockpitParamV1(nextUrl.searchParams, "kind", view.kind);
  setOptionalCockpitParamV1(nextUrl.searchParams, "service", view.service);
  setOptionalCockpitParamV1(
    nextUrl.searchParams,
    "environment",
    view.environment,
  );
  setOptionalCockpitParamV1(nextUrl.searchParams, "release", view.release);
  setOptionalCockpitParamV1(
    nextUrl.searchParams,
    "triage",
    view.triage === "all" ? null : view.triage,
  );
  setOptionalCockpitParamV1(
    nextUrl.searchParams,
    "sort",
    view.sort === "newest" ? null : view.sort,
  );
  setOptionalCockpitParamV1(
    nextUrl.searchParams,
    "operation",
    view.operationId,
  );
  return nextUrl;
}

export function createSignalOpsCockpitShareUrlV1(
  currentUrl: URL,
  view: SignalOpsCockpitViewV1,
): URL {
  const cleanUrl = new URL(currentUrl.pathname, currentUrl.origin);
  return applySignalOpsCockpitViewV1(cleanUrl, view);
}

export function filterSignalOpsOperationsV1<
  T extends Pick<SignalOpsOperationSnapshotV1, "status">,
>(rows: readonly T[], filter: SignalOpsOperationFilterV1): T[] {
  if (filter === "all") return [...rows];
  if (filter === "failed") {
    return rows.filter(
      (row) => row.status !== "succeeded" && row.status !== "running",
    );
  }
  return rows.filter((row) => row.status === filter);
}

export function mergeSignalOpsOperationSamplesV1(
  ...samples: ReadonlyArray<readonly SignalOpsOperationSnapshotV1[]>
): SignalOpsOperationSnapshotV1[] {
  const byOperationId = new Map<string, SignalOpsOperationSnapshotV1>();
  for (const sample of samples) {
    for (const row of sample) {
      if (!byOperationId.has(row.operationId)) {
        byOperationId.set(row.operationId, row);
      }
    }
  }
  return [...byOperationId.values()].sort(
    (left, right) =>
      Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
  );
}

function operationSearchTextV1(row: SignalOpsOperationSnapshotV1): string {
  return [
    row.operationId,
    row.logicalModelKey,
    row.kind,
    row.service,
    row.environment,
    row.release,
    row.failureCategory,
    row.failureCode,
  ]
    .filter(Boolean)
    .join("\n")
    .toLocaleLowerCase();
}

function operationAttentionRankV1(status: SignalOpsOperationSnapshotV1["status"]): number {
  if (status === "failed" || status === "expired" || status === "abandoned") {
    return 0;
  }
  if (status === "cancelled") return 1;
  if (status === "running") return 2;
  return 3;
}

function compareNewestV1(
  left: SignalOpsOperationSnapshotV1,
  right: SignalOpsOperationSnapshotV1,
): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt);
}

function matchesOperationTriageV1(
  row: SignalOpsOperationSnapshotV1,
  triage: SignalOpsOperationTriageV1,
  slowThresholdMs: number | null,
): boolean {
  if (triage === "all") return true;
  if (triage === "retryable") return row.failureRetryable === true;
  if (triage === "unclassified") {
    return (
      row.status !== "succeeded" &&
      row.status !== "running" &&
      (!row.failureCategory || row.failureCategory === "unknown")
    );
  }
  if (triage === "missing_attempts") return row.attemptCount === 0;
  if (triage === "multiple_attempts") return row.attemptCount > 1;
  return (
    slowThresholdMs !== null &&
    row.durationMs !== null &&
    row.durationMs >= slowThresholdMs
  );
}

export function filterAndSortSignalOpsOperationsV1(
  rows: readonly SignalOpsOperationSnapshotV1[],
  query: SignalOpsOperationQueryV1,
): SignalOpsOperationSnapshotV1[] {
  const normalizedQuery = query.query.trim().toLocaleLowerCase();
  const triage = query.triage ?? "all";
  const slowThresholdMs = query.slowThresholdMs ?? null;
  const filtered = filterSignalOpsOperationsV1(rows, query.status).filter(
    (row) =>
      (!query.model || row.logicalModelKey === query.model) &&
      (!query.failure || row.failureCategory === query.failure) &&
      (!query.kind || row.kind === query.kind) &&
      (!query.service || row.service === query.service) &&
      (!query.environment || row.environment === query.environment) &&
      (!query.release || row.release === query.release) &&
      matchesOperationTriageV1(row, triage, slowThresholdMs) &&
      (!normalizedQuery || operationSearchTextV1(row).includes(normalizedQuery)),
  );

  return filtered
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let comparison = 0;
      if (query.sort === "slowest") {
        if (left.row.durationMs === null && right.row.durationMs !== null) {
          comparison = 1;
        } else if (left.row.durationMs !== null && right.row.durationMs === null) {
          comparison = -1;
        } else if (left.row.durationMs !== null && right.row.durationMs !== null) {
          comparison = right.row.durationMs - left.row.durationMs;
        }
      } else if (query.sort === "attempts") {
        comparison = right.row.attemptCount - left.row.attemptCount;
      } else if (query.sort === "attention") {
        comparison =
          operationAttentionRankV1(left.row.status) -
          operationAttentionRankV1(right.row.status);
      }
      if (comparison === 0) comparison = compareNewestV1(left.row, right.row);
      if (comparison === 0) comparison = left.index - right.index;
      return comparison;
    })
    .map(({ row }) => row);
}

export function listSignalOpsOperationDimensionValuesV1(
  rows: readonly SignalOpsOperationSnapshotV1[],
  key: "kind" | "service" | "environment" | "release",
): string[] {
  return [...new Set(rows.flatMap((row) => {
    const value = row[key]?.trim();
    return value ? [value] : [];
  }))].sort((left, right) => left.localeCompare(right));
}

function compareNullableDescendingV1(
  left: number | null,
  right: number | null,
): number {
  if (left === null && right !== null) return 1;
  if (left !== null && right === null) return -1;
  if (left === null || right === null) return 0;
  return right - left;
}

export function filterAndSortSignalOpsModelsV1(
  rows: readonly SignalOpsModelSnapshotV1[],
  query: string,
  sort: SignalOpsModelSortV1,
): SignalOpsModelSnapshotV1[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rows
    .filter(
      (row) =>
        !normalizedQuery ||
        row.modelKey.toLocaleLowerCase().includes(normalizedQuery),
    )
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let comparison = 0;
      if (sort === "volume") {
        comparison = right.row.operations - left.row.operations;
      } else if (sort === "failures") {
        comparison = right.row.failed - left.row.failed;
      } else if (sort === "latency") {
        comparison = compareNullableDescendingV1(
          left.row.p95DurationMs,
          right.row.p95DurationMs,
        );
      } else {
        comparison = left.row.modelKey.localeCompare(right.row.modelKey);
      }
      if (comparison === 0) {
        comparison = left.row.modelKey.localeCompare(right.row.modelKey);
      }
      if (comparison === 0) comparison = left.index - right.index;
      return comparison;
    })
    .map(({ row }) => row);
}

function providerAttentionRankV1(
  status: SignalOpsProviderSnapshotV1["health"]["status"],
): number {
  if (status === "incident") return 0;
  if (status === "degraded") return 1;
  if (status === "insufficient_data") return 2;
  return 3;
}

export function filterAndSortSignalOpsProvidersV1(
  rows: readonly SignalOpsProviderSnapshotV1[],
  query: string,
  sort: SignalOpsProviderSortV1,
): SignalOpsProviderSnapshotV1[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return rows
    .filter((row) => {
      if (!normalizedQuery) return true;
      return [
        row.providerKey,
        row.providerVendor,
        row.modelKey,
        row.health.status,
      ]
        .filter(Boolean)
        .join("\n")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    })
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      let comparison = 0;
      if (sort === "attention") {
        comparison =
          providerAttentionRankV1(left.row.health.status) -
          providerAttentionRankV1(right.row.health.status);
        if (comparison === 0) {
          comparison =
            (1 - (right.row.successRate ?? 1)) -
            (1 - (left.row.successRate ?? 1));
        }
      } else if (sort === "attempts") {
        comparison = right.row.attempts - left.row.attempts;
      } else if (sort === "latency") {
        comparison = compareNullableDescendingV1(
          left.row.p95DurationMs,
          right.row.p95DurationMs,
        );
      } else {
        comparison = `${left.row.providerKey}\n${left.row.modelKey}`.localeCompare(
          `${right.row.providerKey}\n${right.row.modelKey}`,
        );
      }
      if (comparison === 0) {
        comparison = `${left.row.providerKey}\n${left.row.modelKey}`.localeCompare(
          `${right.row.providerKey}\n${right.row.modelKey}`,
        );
      }
      if (comparison === 0) comparison = left.index - right.index;
      return comparison;
    })
    .map(({ row }) => row);
}

function sumTimelineHalfV1(rows: readonly SignalOpsTimelineBucketV1[]) {
  const operations = rows.reduce((total, row) => total + row.operations, 0);
  const failedOperations = rows.reduce(
    (total, row) => total + row.failedOperations,
    0,
  );
  return {
    operations,
    failedOperations,
    attempts: rows.reduce((total, row) => total + row.attempts, 0),
    failureRate: operations === 0 ? null : failedOperations / operations,
  };
}

function ratioDeltaV1(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export function summarizeSignalOpsTimelineV1(
  rows: readonly SignalOpsTimelineBucketV1[],
): SignalOpsTimelinePulseV1 {
  const halfSize = Math.floor(rows.length / 2);
  const earlierRows = halfSize === 0 ? [] : rows.slice(0, halfSize);
  const recentRows = halfSize === 0 ? [] : rows.slice(rows.length - halfSize);
  const earlier = sumTimelineHalfV1(earlierRows);
  const recent = sumTimelineHalfV1(recentRows);

  let peakVolume: SignalOpsTimelineBucketV1 | null = null;
  let peakFailure: SignalOpsTimelineBucketV1 | null = null;
  let peakLatency: SignalOpsTimelineBucketV1 | null = null;
  for (const row of rows) {
    if (!peakVolume || row.operations >= peakVolume.operations) peakVolume = row;
    if (
      row.operations > 0 &&
      (!peakFailure ||
        row.failedOperations / row.operations >=
          peakFailure.failedOperations / peakFailure.operations)
    ) {
      peakFailure = row;
    }
    if (
      row.p95DurationMs !== null &&
      (!peakLatency ||
        peakLatency.p95DurationMs === null ||
        row.p95DurationMs >= peakLatency.p95DurationMs)
    ) {
      peakLatency = row;
    }
  }

  return {
    earlier,
    recent,
    operationDeltaRatio: ratioDeltaV1(recent.operations, earlier.operations),
    failureRateDelta:
      recent.failureRate === null || earlier.failureRate === null
        ? null
        : recent.failureRate - earlier.failureRate,
    peaks: {
      volume: peakVolume,
      failureRate: peakFailure,
      latency: peakLatency,
    },
  };
}

function safeSavedViewDimensionV1(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.length > MAX_COCKPIT_DIMENSION_LENGTH_V1 ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    return null;
  }
  return trimmed;
}

function sanitizeSavedCockpitViewV1(value: unknown): SignalOpsCockpitViewV1 | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SignalOpsCockpitViewV1>;
  if (!SIGNALOPS_COCKPIT_RANGES_V1.has(candidate.range as SignalOpsOpsRangeV1)) {
    return null;
  }
  return {
    range: candidate.range as SignalOpsOpsRangeV1,
    status: SIGNALOPS_COCKPIT_FILTERS_V1.has(
      candidate.status as SignalOpsOperationFilterV1,
    )
      ? (candidate.status as SignalOpsOperationFilterV1)
      : "all",
    model: safeSavedViewDimensionV1(candidate.model),
    failure: safeSavedViewDimensionV1(candidate.failure),
    kind: safeSavedViewDimensionV1(candidate.kind),
    service: safeSavedViewDimensionV1(candidate.service),
    environment: safeSavedViewDimensionV1(candidate.environment),
    release: safeSavedViewDimensionV1(candidate.release),
    triage: SIGNALOPS_COCKPIT_TRIAGE_V1.has(
      candidate.triage as SignalOpsOperationTriageV1,
    )
      ? (candidate.triage as SignalOpsOperationTriageV1)
      : "all",
    sort: SIGNALOPS_COCKPIT_SORTS_V1.has(
      candidate.sort as SignalOpsOperationSortV1,
    )
      ? (candidate.sort as SignalOpsOperationSortV1)
      : "newest",
    operationId: null,
  };
}

export function createSignalOpsSavedCockpitViewV1(
  id: string,
  name: string,
  view: SignalOpsCockpitViewV1,
  createdAt = new Date().toISOString(),
): SignalOpsSavedCockpitViewV1 | null {
  const safeId = id.trim();
  const safeName = name.trim();
  const safeView = sanitizeSavedCockpitViewV1(view);
  if (
    !/^[a-zA-Z0-9_-]{1,80}$/u.test(safeId) ||
    !safeName ||
    safeName.length > MAX_SAVED_COCKPIT_VIEW_NAME_LENGTH_V1 ||
    /[\u0000-\u001f\u007f]/u.test(safeName) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    !safeView
  ) {
    return null;
  }
  return { id: safeId, name: safeName, createdAt, view: safeView };
}

export function readSignalOpsSavedCockpitViewsV1(
  raw: string | null,
): SignalOpsSavedCockpitViewV1[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_SAVED_COCKPIT_VIEWS_V1).flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const candidate = value as Partial<SignalOpsSavedCockpitViewV1>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.name !== "string" ||
        typeof candidate.createdAt !== "string" ||
        !candidate.view
      ) {
        return [];
      }
      const saved = createSignalOpsSavedCockpitViewV1(
        candidate.id,
        candidate.name,
        candidate.view,
        candidate.createdAt,
      );
      return saved ? [saved] : [];
    });
  } catch {
    return [];
  }
}

export function serializeSignalOpsSavedCockpitViewsV1(
  views: readonly SignalOpsSavedCockpitViewV1[],
): string {
  const safeViews = readSignalOpsSavedCockpitViewsV1(JSON.stringify(views));
  return JSON.stringify(safeViews);
}

function markdownCodeV1(value: string): string {
  return `\`${value.replaceAll("`", "'").replace(/[\r\n]+/gu, " ")}\``;
}

function percentTextV1(value: number | null): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}

function durationTextV1(value: number | null): string {
  if (value === null) return "unavailable";
  return value >= 1_000
    ? `${(value / 1_000).toFixed(1)}s`
    : `${Math.round(value)}ms`;
}

export function buildSignalOpsCockpitBriefV1(
  snapshot: SignalOpsOpsSnapshotV1,
  view: SignalOpsCockpitViewV1,
  retainedMatches: number,
  indexedRows: number,
): string {
  const filters = [
    view.status !== "all" ? `status=${view.status}` : null,
    view.model ? `model=${view.model}` : null,
    view.failure ? `failure=${view.failure}` : null,
    view.kind ? `kind=${view.kind}` : null,
    view.service ? `service=${view.service}` : null,
    view.environment ? `environment=${view.environment}` : null,
    view.release ? `release=${view.release}` : null,
    view.triage !== "all" ? `triage=${view.triage}` : null,
    view.sort !== "newest" ? `sort=${view.sort}` : null,
  ].filter((value): value is string => Boolean(value));
  const attemptCoverage =
    snapshot.totals.operations === 0
      ? null
      : snapshot.totals.operationsWithAttemptTelemetry /
        snapshot.totals.operations;

  return [
    "# SignalOps investigation brief",
    "",
    `- Workspace: ${markdownCodeV1(snapshot.tenant.name)}`,
    `- Window: ${markdownCodeV1(snapshot.range)}`,
    `- Snapshot: ${markdownCodeV1(snapshot.generatedAt)}`,
    `- Operations: ${snapshot.totals.operations}`,
    `- Failed: ${snapshot.totals.failed}`,
    `- Success rate: ${percentTextV1(snapshot.totals.successRate)}`,
    `- Operation p95: ${durationTextV1(snapshot.totals.p95DurationMs)}`,
    `- Explicit attempt coverage: ${percentTextV1(attemptCoverage)}`,
    `- Failure classification coverage: ${percentTextV1(snapshot.coverage.failureClassification.ratio)}`,
    `- Retained view: ${retainedMatches} matches across ${indexedRows} indexed rows`,
    `- Filters: ${filters.length > 0 ? filters.map(markdownCodeV1).join(", ") : "none"}`,
    "",
    "Privacy boundary: canonical identifiers and operational evidence only; no prompts, media, customer identity, credentials, or raw errors.",
  ].join("\n");
}

export function buildSignalOpsCockpitJsonExportV1(
  snapshot: SignalOpsOpsSnapshotV1,
  view: SignalOpsCockpitViewV1,
  retainedRows: readonly SignalOpsOperationSnapshotV1[],
  exportedAt = new Date().toISOString(),
): string {
  const safeView = sanitizeSavedCockpitViewV1(view);
  if (!safeView) throw new Error("invalid cockpit view");
  return `${JSON.stringify(
    {
      schema: "com.signalops.cockpit.export.v1",
      exportedAt,
      workspace: snapshot.tenant,
      window: snapshot.range,
      snapshotGeneratedAt: snapshot.generatedAt,
      freshness: snapshot.freshness,
      projection: snapshot.projection,
      totals: snapshot.totals,
      coverage: snapshot.coverage,
      dataQuality: snapshot.dataQuality,
      environments: snapshot.environments,
      timeline: snapshot.timeline,
      providerRoutes: snapshot.providers,
      models: snapshot.models,
      failures: snapshot.failureBreakdown,
      view: safeView,
      retainedOperations: retainedRows,
      privacy:
        "Canonical operational evidence only; source payloads and free-form search are excluded.",
    },
    null,
    2,
  )}\n`;
}

function escapeSignalOpsCsvCellV1(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[\t\r ]*[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildSignalOpsOperationsCsvV1(
  rows: readonly SignalOpsOperationSnapshotV1[],
): string {
  const table: unknown[][] = [
    [
      "Operation ID",
      "Status",
      "Logical model",
      "Operation kind",
      "Service",
      "Environment",
      "Release",
      "Failure category",
      "Failure code",
      "Retryable",
      "Duration ms",
      "Attempt count",
      "Occurred at UTC",
    ],
    ...rows.map((row) => [
      row.operationId,
      row.status,
      row.logicalModelKey,
      row.kind,
      row.service,
      row.environment,
      row.release,
      row.failureCategory,
      row.failureCode,
      row.failureRetryable,
      row.durationMs,
      row.attemptCount,
      row.occurredAt,
    ]),
  ];
  return `${table
    .map((row) => row.map(escapeSignalOpsCsvCellV1).join(","))
    .join("\r\n")}\r\n`;
}

export function paginateSignalOpsRowsV1<T>(
  rows: readonly T[],
  requestedPage: number,
  requestedPageSize: number,
): { rows: T[]; page: number; pageCount: number; total: number } {
  const pageSize = Math.max(1, Math.floor(requestedPageSize) || 1);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Math.floor(requestedPage) || 1),
  );
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page,
    pageCount,
    total: rows.length,
  };
}

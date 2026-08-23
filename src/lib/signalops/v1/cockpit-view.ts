import type {
  SignalOpsOperationSnapshotV1,
  SignalOpsOpsRangeV1,
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

export type SignalOpsCockpitViewV1 = {
  range: SignalOpsOpsRangeV1;
  status: SignalOpsOperationFilterV1;
  model: string | null;
  failure: string | null;
  sort: SignalOpsOperationSortV1;
  operationId: string | null;
};

export type SignalOpsOperationQueryV1 = Pick<
  SignalOpsCockpitViewV1,
  "status" | "model" | "failure" | "sort"
> & {
  query: string;
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

const MAX_COCKPIT_DIMENSION_LENGTH_V1 = 160;
const MAX_COCKPIT_OPERATION_ID_LENGTH_V1 = 256;

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

export function filterAndSortSignalOpsOperationsV1(
  rows: readonly SignalOpsOperationSnapshotV1[],
  query: SignalOpsOperationQueryV1,
): SignalOpsOperationSnapshotV1[] {
  const normalizedQuery = query.query.trim().toLocaleLowerCase();
  const filtered = filterSignalOpsOperationsV1(rows, query.status).filter(
    (row) =>
      (!query.model || row.logicalModelKey === query.model) &&
      (!query.failure || row.failureCategory === query.failure) &&
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

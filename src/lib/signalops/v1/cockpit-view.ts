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

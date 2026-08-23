import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
} from "./supabase.ts";

export type SignalOpsRetentionResultV1 = {
  eventsDeleted: number;
  conflictsDeleted: number;
  auditRowsDeleted: number;
  rateLimitBucketsDeleted: number;
};

type RetentionRow = {
  events_deleted: number;
  conflicts_deleted: number;
  audit_rows_deleted: number;
  rate_limit_buckets_deleted: number;
};

function retentionDays(name: string, fallback: number, minimum: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < minimum || value > 3_650) {
    throw new Error(`${name} must be an integer between ${minimum} and 3650`);
  }
  return value;
}

export function isSignalOpsRetentionConfiguredV1(): boolean {
  return process.env.SIGNALOPS_RETENTION_ENABLED === "true";
}

export async function applySignalOpsRetentionV1(
  now = new Date(),
): Promise<SignalOpsRetentionResultV1 | null> {
  if (!isSignalOpsRetentionConfiguredV1()) return null;
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return null;

  const cutOff = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString();
  const rows = await signalOpsSupabaseRestRequestV1<RetentionRow[]>(
    config,
    "rpc/signalops_v1_apply_retention",
    {
      method: "POST",
      body: JSON.stringify({
        p_raw_before: cutOff(retentionDays("SIGNALOPS_RAW_RETENTION_DAYS", 100, 91)),
        p_conflict_before: cutOff(
          retentionDays("SIGNALOPS_CONFLICT_RETENTION_DAYS", 400, 30),
        ),
        p_audit_before: cutOff(retentionDays("SIGNALOPS_AUDIT_RETENTION_DAYS", 400, 30)),
        p_rate_limit_before: cutOff(
          retentionDays("SIGNALOPS_RATE_LIMIT_RETENTION_DAYS", 2, 1),
        ),
      }),
    },
  );
  const row = rows[0];
  if (!row) throw new Error("SignalOps retention RPC returned no result");
  return {
    eventsDeleted: Number(row.events_deleted),
    conflictsDeleted: Number(row.conflicts_deleted),
    auditRowsDeleted: Number(row.audit_rows_deleted),
    rateLimitBucketsDeleted: Number(row.rate_limit_buckets_deleted),
  };
}

import type { SignalOpsOpsRangeV1, SignalOpsOpsSnapshotV1 } from "./ops-snapshot.ts";
import {
  getSignalOpsSupabaseConfigV1,
  signalOpsSupabaseRestRequestV1,
  type SignalOpsSupabaseConfigV1,
} from "./supabase.ts";

export type SignalOpsProjectionWatermarkV1 = {
  receivedAt: string | null;
  eventId: string | null;
  eventCount: number;
};

type ProjectionRow = {
  tenant_id: string;
  range_key: SignalOpsOpsRangeV1;
  checkpoint_received_at: string | null;
  checkpoint_event_id: string | null;
  source_event_count: number;
  snapshot: SignalOpsOpsSnapshotV1;
  projected_at: string;
};

export function isSignalOpsProjectionRepositoryConfiguredV1(): boolean {
  return Boolean(getSignalOpsSupabaseConfigV1());
}

function isMatchingSnapshot(
  row: ProjectionRow,
  tenantId: string,
  range: SignalOpsOpsRangeV1,
  watermark: SignalOpsProjectionWatermarkV1,
  now: Date,
): boolean {
  return (
    row.tenant_id === tenantId &&
    row.range_key === range &&
    row.checkpoint_received_at === watermark.receivedAt &&
    row.checkpoint_event_id === watermark.eventId &&
    Number(row.source_event_count) === watermark.eventCount &&
    row.snapshot?.tenant?.id === tenantId &&
    row.snapshot?.range === range &&
    Array.isArray(row.snapshot?.timeline) &&
    Array.isArray(row.snapshot?.models) &&
    Array.isArray(row.snapshot?.recentFailedOperations) &&
    Number.isFinite(row.snapshot?.totals?.operationsWithAttemptTelemetry) &&
    Date.parse(row.projected_at) >= now.getTime() - 60_000
  );
}

export async function readSignalOpsMaterializedSnapshotV1(input: {
  tenantId: string;
  range: SignalOpsOpsRangeV1;
  watermark: SignalOpsProjectionWatermarkV1;
  now?: Date;
}): Promise<SignalOpsOpsSnapshotV1 | null> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return null;
  const filters = new URLSearchParams({
    select:
      "tenant_id,range_key,checkpoint_received_at,checkpoint_event_id,source_event_count,snapshot,projected_at",
    tenant_id: `eq.${input.tenantId}`,
    range_key: `eq.${input.range}`,
    limit: "1",
  });
  const rows = await signalOpsSupabaseRestRequestV1<ProjectionRow[]>(
    config,
    `signalops_v1_projection_snapshots?${filters}`,
  );
  const row = rows[0];
  return row &&
    isMatchingSnapshot(
      row,
      input.tenantId,
      input.range,
      input.watermark,
      input.now ?? new Date(),
    )
    ? row.snapshot
    : null;
}

async function writeCheckpoint(
  config: SignalOpsSupabaseConfigV1,
  input: {
    tenantId: string;
    watermark: SignalOpsProjectionWatermarkV1;
    sourceDigest: string;
  },
): Promise<void> {
  await signalOpsSupabaseRestRequestV1<null>(
    config,
    "signalops_v1_projection_checkpoints?on_conflict=tenant_id,projector",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        projector: "ops-snapshot-v1",
        last_received_at: input.watermark.receivedAt,
        last_event_id: input.watermark.eventId,
        source_event_count: input.watermark.eventCount,
        source_digest: input.sourceDigest,
        updated_at: new Date().toISOString(),
      }),
    },
  );
}

export async function writeSignalOpsMaterializedSnapshotV1(input: {
  tenantId: string;
  range: SignalOpsOpsRangeV1;
  watermark: SignalOpsProjectionWatermarkV1;
  sourceDigest: string;
  snapshot: SignalOpsOpsSnapshotV1;
}): Promise<void> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return;
  await signalOpsSupabaseRestRequestV1<null>(
    config,
    "signalops_v1_projection_snapshots?on_conflict=tenant_id,range_key",
    {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        range_key: input.range,
        checkpoint_received_at: input.watermark.receivedAt,
        checkpoint_event_id: input.watermark.eventId,
        source_event_count: input.watermark.eventCount,
        snapshot: input.snapshot,
        projected_at: new Date().toISOString(),
      }),
    },
  );
  await writeCheckpoint(config, input);
}

export async function countSignalOpsConflictsV1(input: {
  tenantId: string;
  since: string;
}): Promise<number> {
  const config = getSignalOpsSupabaseConfigV1();
  if (!config) return 0;
  const count = await signalOpsSupabaseRestRequestV1<number>(
    config,
    "rpc/signalops_v1_conflict_count",
    {
      method: "POST",
      body: JSON.stringify({ p_tenant_id: input.tenantId, p_since: input.since }),
    },
  );
  return Number(count);
}

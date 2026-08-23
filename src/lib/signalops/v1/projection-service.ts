import { createHash } from "node:crypto";

import type { StoredSignalOpsEventV1 } from "./event-store.ts";
import {
  buildSignalOpsOpsSnapshotV1,
  rangeStartV1,
  type SignalOpsOpsRangeV1,
  type SignalOpsOpsSnapshotV1,
} from "./ops-snapshot.ts";
import {
  countSignalOpsConflictsV1,
  isSignalOpsProjectionRepositoryConfiguredV1,
  readSignalOpsMaterializedSnapshotV1,
  writeSignalOpsMaterializedSnapshotV1,
} from "./projection-repository.ts";
import { getSignalOpsRuntimeStoreV1 } from "./runtime.ts";

const MAX_REBUILD_EVENTS = 100_000;

function sourceDigest(records: readonly StoredSignalOpsEventV1[]): string {
  const hash = createHash("sha256");
  for (const record of [...records].sort((left, right) => left.event.id.localeCompare(right.event.id))) {
    hash.update(record.event.id);
    hash.update(":");
    hash.update(record.payloadDigest);
    hash.update("\n");
  }
  return hash.digest("hex");
}

export async function getSignalOpsOpsSnapshotV1(input: {
  tenantId: string;
  tenantName: string;
  range: SignalOpsOpsRangeV1;
  now?: Date;
}): Promise<SignalOpsOpsSnapshotV1> {
  const now = input.now ?? new Date();
  const since = rangeStartV1(input.range, now);
  const store = getSignalOpsRuntimeStoreV1();
  const watermark = await store.watermark(input.tenantId);
  const repositoryConfigured = isSignalOpsProjectionRepositoryConfiguredV1();
  if (repositoryConfigured) {
    const cached = await readSignalOpsMaterializedSnapshotV1({
      tenantId: input.tenantId,
      range: input.range,
      watermark,
      now,
    });
    if (cached) {
      return {
        ...cached,
        tenant: { id: input.tenantId, name: input.tenantName },
      };
    }
  }

  const records = await store.list(input.tenantId, {
    limit: MAX_REBUILD_EVENTS + 1,
  });
  const truncated = records.length > MAX_REBUILD_EVENTS || watermark.eventCount > MAX_REBUILD_EVENTS;
  const boundedRecords = records.slice(0, MAX_REBUILD_EVENTS);
  const idempotencyConflictCount = await countSignalOpsConflictsV1({
    tenantId: input.tenantId,
    since,
  });
  const snapshot = buildSignalOpsOpsSnapshotV1({
    ...input,
    now,
    records: boundedRecords,
    sourceTruncated: truncated,
    idempotencyConflictCount,
    sourceEventCount: watermark.eventCount,
    checkpointReceivedAt: watermark.receivedAt,
    materialized: repositoryConfigured,
  });
  if (repositoryConfigured) {
    await writeSignalOpsMaterializedSnapshotV1({
      tenantId: input.tenantId,
      range: input.range,
      watermark,
      sourceDigest: sourceDigest(boundedRecords),
      snapshot,
    });
  }
  return snapshot;
}

import { createHash } from "node:crypto";

import { canonicalSignalOpsEventTextV1 } from "./contract.ts";
import type { SignalOpsEventV1 } from "./types.ts";

export type StoredSignalOpsEventV1 = {
  tenantId: string;
  event: SignalOpsEventV1;
  payloadDigest: string;
  receivedAt: string;
};

export type SignalOpsEventStoreWriteResultV1 = {
  storedEventIds: string[];
  duplicateEventIds: string[];
  conflictEventIds: string[];
};

export interface SignalOpsEventStoreV1 {
  store(
    tenantId: string,
    events: readonly SignalOpsEventV1[],
  ): Promise<SignalOpsEventStoreWriteResultV1>;
}

export type MemorySignalOpsEventStoreV1 = SignalOpsEventStoreV1 & {
  reset(): void;
  snapshot(tenantId?: string): StoredSignalOpsEventV1[];
};

function eventDigest(event: SignalOpsEventV1): string {
  return createHash("sha256").update(canonicalSignalOpsEventTextV1(event), "utf8").digest("hex");
}

function assertTenantId(tenantId: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(tenantId)) {
    throw new Error("tenantId must be a bounded opaque identifier");
  }
}

export function createMemorySignalOpsEventStoreV1(
  options: { receivedAtFactory?: () => string } = {},
): MemorySignalOpsEventStoreV1 {
  const receivedAtFactory = options.receivedAtFactory ?? (() => new Date().toISOString());
  const records = new Map<string, StoredSignalOpsEventV1>();

  return {
    async store(tenantId, events) {
      assertTenantId(tenantId);

      const storedEventIds: string[] = [];
      const duplicateEventIds: string[] = [];
      const conflictEventIds: string[] = [];

      for (const event of events) {
        const key = `${tenantId}:${event.id}`;
        const payloadDigest = eventDigest(event);
        const existing = records.get(key);

        if (existing) {
          if (existing.payloadDigest === payloadDigest) {
            duplicateEventIds.push(event.id);
          } else {
            conflictEventIds.push(event.id);
          }
          continue;
        }

        records.set(key, {
          tenantId,
          event: structuredClone(event),
          payloadDigest,
          receivedAt: receivedAtFactory(),
        });
        storedEventIds.push(event.id);
      }

      return { storedEventIds, duplicateEventIds, conflictEventIds };
    },
    reset() {
      records.clear();
    },
    snapshot(tenantId) {
      return [...records.values()]
        .filter((record) => tenantId === undefined || record.tenantId === tenantId)
        .map((record) => structuredClone(record));
    },
  };
}

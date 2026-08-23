import { createHash } from "node:crypto";

import { canonicalSignalOpsEventTextV1 } from "./contract.ts";
import { assertSignalOpsTenantPrincipalV1 } from "./principal.ts";
import type { SignalOpsEventV1, SignalOpsTenantPrincipalV1 } from "./types.ts";

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
    principal: SignalOpsTenantPrincipalV1,
    events: readonly SignalOpsEventV1[],
  ): Promise<SignalOpsEventStoreWriteResultV1>;
}

export interface SignalOpsEventReaderV1 {
  list(
    tenantId: string,
    options?: { since?: string; limit?: number },
  ): Promise<StoredSignalOpsEventV1[]>;
  watermark(
    tenantId: string,
    options?: { since?: string },
  ): Promise<{ receivedAt: string | null; eventId: string | null; eventCount: number }>;
}

export type MemorySignalOpsEventStoreV1 = SignalOpsEventStoreV1 & SignalOpsEventReaderV1 & {
  reset(): void;
  snapshot(tenantId?: string): StoredSignalOpsEventV1[];
};

export function signalOpsEventDigestV1(event: SignalOpsEventV1): string {
  return createHash("sha256").update(canonicalSignalOpsEventTextV1(event), "utf8").digest("hex");
}

export function createMemorySignalOpsEventStoreV1(
  options: { receivedAtFactory?: () => string } = {},
): MemorySignalOpsEventStoreV1 {
  const receivedAtFactory = options.receivedAtFactory ?? (() => new Date().toISOString());
  const records = new Map<string, StoredSignalOpsEventV1>();

  return {
    async store(principal, events) {
      assertSignalOpsTenantPrincipalV1(principal, "events:write");
      const { tenantId } = principal;

      const storedEventIds: string[] = [];
      const duplicateEventIds: string[] = [];
      const conflictEventIds: string[] = [];

      for (const event of events) {
        const key = `${tenantId}:${event.id}`;
        const payloadDigest = signalOpsEventDigestV1(event);
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
    async list(tenantId, options = {}) {
      const sinceMs = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
      const limit = Math.max(1, Math.min(options.limit ?? 5_000, 100_001));

      return [...records.values()]
        .filter(
          (record) =>
            record.tenantId === tenantId &&
            Date.parse(record.event.time) >= sinceMs,
        )
        .sort((left, right) => right.event.time.localeCompare(left.event.time))
        .slice(0, limit)
        .map((record) => structuredClone(record));
    },
    async watermark(tenantId, options = {}) {
      const sinceMs = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
      const latest = [...records.values()]
        .filter(
          (record) =>
            record.tenantId === tenantId && Date.parse(record.event.time) >= sinceMs,
        )
        .sort(
          (left, right) =>
            right.receivedAt.localeCompare(left.receivedAt) ||
            right.event.id.localeCompare(left.event.id),
        )[0];
      return {
        receivedAt: latest?.receivedAt ?? null,
        eventId: latest?.event.id ?? null,
        eventCount: [...records.values()].filter(
          (record) =>
            record.tenantId === tenantId && Date.parse(record.event.time) >= sinceMs,
        ).length,
      };
    },
  };
}

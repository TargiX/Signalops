import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  signalOpsEventDigestV1,
  type SignalOpsEventReaderV1,
  type SignalOpsEventStoreV1,
  type StoredSignalOpsEventV1,
} from "./event-store.ts";
import { assertSignalOpsTenantPrincipalV1 } from "./principal.ts";

export type FileSignalOpsEventStoreV1 = SignalOpsEventStoreV1 & SignalOpsEventReaderV1;

function parseRecords(text: string): StoredSignalOpsEventV1[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as StoredSignalOpsEventV1;
      } catch {
        throw new Error(`invalid SignalOps event store record on line ${index + 1}`);
      }
    });
}

async function readRecords(filePath: string): Promise<StoredSignalOpsEventV1[]> {
  try {
    return parseRecords(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function createFileSignalOpsEventStoreV1(options: {
  filePath: string;
  receivedAtFactory?: () => string;
}): FileSignalOpsEventStoreV1 {
  const filePath = path.resolve(options.filePath);
  const receivedAtFactory = options.receivedAtFactory ?? (() => new Date().toISOString());
  let writeQueue = Promise.resolve();

  return {
    async store(principal, events) {
      assertSignalOpsTenantPrincipalV1(principal, "events:write");

      const result = {
        storedEventIds: [] as string[],
        duplicateEventIds: [] as string[],
        conflictEventIds: [] as string[],
      };

      const write = writeQueue.then(async () => {
        const records = await readRecords(filePath);
        const existingById = new Map(
          records
            .filter((record) => record.tenantId === principal.tenantId)
            .map((record) => [record.event.id, record]),
        );
        const additions: StoredSignalOpsEventV1[] = [];

        for (const event of events) {
          const payloadDigest = signalOpsEventDigestV1(event);
          const existing = existingById.get(event.id);

          if (existing) {
            if (existing.payloadDigest === payloadDigest) {
              result.duplicateEventIds.push(event.id);
            } else {
              result.conflictEventIds.push(event.id);
            }
            continue;
          }

          const record: StoredSignalOpsEventV1 = {
            tenantId: principal.tenantId,
            event: structuredClone(event),
            payloadDigest,
            receivedAt: receivedAtFactory(),
          };
          additions.push(record);
          existingById.set(event.id, record);
          result.storedEventIds.push(event.id);
        }

        if (additions.length > 0) {
          await mkdir(path.dirname(filePath), { recursive: true });
          await appendFile(
            filePath,
            `${additions.map((record) => JSON.stringify(record)).join("\n")}\n`,
            { encoding: "utf8", mode: 0o600 },
          );
        }
      });

      writeQueue = write.catch(() => undefined);
      await write;
      return result;
    },
    async list(tenantId, options = {}) {
      await writeQueue;
      const sinceMs = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
      const limit = Math.max(1, Math.min(options.limit ?? 5_000, 100_001));

      return (await readRecords(filePath))
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
      await writeQueue;
      const sinceMs = options.since ? Date.parse(options.since) : Number.NEGATIVE_INFINITY;
      const scoped = (await readRecords(filePath)).filter(
          (record) =>
            record.tenantId === tenantId && Date.parse(record.event.time) >= sinceMs,
        );
      const latest = scoped.sort(
          (left, right) =>
            right.receivedAt.localeCompare(left.receivedAt) ||
            right.event.id.localeCompare(left.event.id),
        )[0];
      return {
        receivedAt: latest?.receivedAt ?? null,
        eventId: latest?.event.id ?? null,
        eventCount: scoped.length,
      };
    },
  };
}

import { normalizeSignalOpsEventBatchV1 } from "./contract.ts";
import type { SignalOpsBatchRejectionV1 } from "./contract.ts";
import type { SignalOpsEventStoreV1 } from "./event-store.ts";

export type SignalOpsIngestReceiptV1 = {
  acceptedEvents: number;
  rejectedEvents: number;
  storedEvents: number;
  duplicateEvents: number;
  conflictEvents: number;
  storedEventIds: string[];
  duplicateEventIds: string[];
  conflictEventIds: string[];
  rejected: SignalOpsBatchRejectionV1[];
};

export async function ingestSignalOpsEventsV1(input: {
  tenantId: string;
  payload: unknown;
  store: SignalOpsEventStoreV1;
}): Promise<SignalOpsIngestReceiptV1> {
  const batch = normalizeSignalOpsEventBatchV1(input.payload);
  const writeResult = await input.store.store(input.tenantId, batch.events);

  return {
    acceptedEvents: batch.events.length,
    rejectedEvents: batch.rejected.length,
    storedEvents: writeResult.storedEventIds.length,
    duplicateEvents: writeResult.duplicateEventIds.length,
    conflictEvents: writeResult.conflictEventIds.length,
    storedEventIds: writeResult.storedEventIds,
    duplicateEventIds: writeResult.duplicateEventIds,
    conflictEventIds: writeResult.conflictEventIds,
    rejected: batch.rejected,
  };
}

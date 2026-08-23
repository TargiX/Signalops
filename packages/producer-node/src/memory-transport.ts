import type { SignalOpsEventV1 } from "@signalops/contracts/v1";

import type {
  SignalOpsDeliveryReportV1,
  SignalOpsProducerTransportV1,
} from "./transport.js";

export interface SignalOpsMemoryTransportV1 extends SignalOpsProducerTransportV1 {
  events(): readonly SignalOpsEventV1[];
  clear(): void;
}

export function createSignalOpsMemoryTransportV1(): SignalOpsMemoryTransportV1 {
  const delivered: SignalOpsEventV1[] = [];
  let queue: SignalOpsEventV1[] = [];
  let closed = false;

  return {
    enqueue(events) {
      if (closed) return;
      queue.push(...events.map((event) => structuredClone(event)));
    },
    async flush(): Promise<SignalOpsDeliveryReportV1> {
      const batch = queue;
      queue = [];
      delivered.push(...batch);
      return {
        deliveredEvents: batch.length,
        duplicateEvents: 0,
        deadLetteredEvents: 0,
        pendingEvents: 0,
      };
    },
    async close(): Promise<SignalOpsDeliveryReportV1> {
      const report = await this.flush();
      closed = true;
      return report;
    },
    pending() {
      return queue.length;
    },
    events() {
      return structuredClone(delivered);
    },
    clear() {
      delivered.length = 0;
      queue = [];
    },
  };
}

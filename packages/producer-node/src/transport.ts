import type { SignalOpsEventV1 } from "@signalops/contracts/v1";

export type SignalOpsDeadLetterReasonV1 =
  | "authentication_failed"
  | "closed"
  | "event_too_large"
  | "ingest_conflict"
  | "ingest_rejected"
  | "invalid_response"
  | "non_retryable_response"
  | "queue_overflow"
  | "retry_exhausted";

export type SignalOpsDeadLetterV1 = Readonly<{
  events: readonly SignalOpsEventV1[];
  reason: SignalOpsDeadLetterReasonV1;
  attempts: number;
  status?: number;
}>;

export type SignalOpsDeliveryReportV1 = Readonly<{
  deliveredEvents: number;
  duplicateEvents: number;
  deadLetteredEvents: number;
  pendingEvents: number;
}>;

export interface SignalOpsProducerTransportV1 {
  enqueue(events: readonly SignalOpsEventV1[]): void;
  flush(): Promise<SignalOpsDeliveryReportV1>;
  close(): Promise<SignalOpsDeliveryReportV1>;
  pending(): number;
}

export function emptySignalOpsDeliveryReportV1(
  pendingEvents = 0,
): SignalOpsDeliveryReportV1 {
  return {
    deliveredEvents: 0,
    duplicateEvents: 0,
    deadLetteredEvents: 0,
    pendingEvents,
  };
}

import {
  buildSignalOpsOperationTraceV1,
  type SignalOpsOperationTraceV1,
} from "./operation-trace.ts";
import { getSignalOpsRuntimeStoreV1 } from "./runtime.ts";

const MAX_OPERATION_TRACE_EVENTS_V1 = 1_000;

export async function getSignalOpsOperationTraceV1(input: {
  tenantId: string;
  operationId: string;
}): Promise<SignalOpsOperationTraceV1 | null> {
  const store = getSignalOpsRuntimeStoreV1();
  const records = await store.listBySubject(
    input.tenantId,
    `operation/${input.operationId}`,
    { limit: MAX_OPERATION_TRACE_EVENTS_V1 + 1 },
  );
  return buildSignalOpsOperationTraceV1({
    ...input,
    records: records.slice(0, MAX_OPERATION_TRACE_EVENTS_V1),
    sourceTruncated: records.length > MAX_OPERATION_TRACE_EVENTS_V1,
  });
}

import {
  dispatchSignalOpsIncidentAlertsV1,
  evaluateSignalOpsIncidentsV1,
  syncSignalOpsIncidentsV1,
} from "./incidents.ts";
import { getSignalOpsOpsSnapshotV1 } from "./projection-service.ts";

export async function evaluateSignalOpsTenantV1(input: {
  tenantId: string;
  tenantName: string;
}): Promise<{ transitions: number }> {
  const snapshot = await getSignalOpsOpsSnapshotV1({
    ...input,
    range: "24h",
  });
  const synced = await syncSignalOpsIncidentsV1({
    tenantId: input.tenantId,
    decisions: evaluateSignalOpsIncidentsV1(snapshot),
  });
  await dispatchSignalOpsIncidentAlertsV1(synced.transitions);
  return { transitions: synced.transitions.length };
}

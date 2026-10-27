import {
  dispatchSignalOpsIncidentAlertsV1,
  evaluateSignalOpsIncidentsV1,
  syncSignalOpsIncidentsV1,
} from "./incidents.ts";
import type { SignalOpsOpsRangeV1, SignalOpsOpsSnapshotV1 } from "./ops-snapshot.ts";
import { getSignalOpsOpsSnapshotV1 } from "./projection-service.ts";
import { listSignalOpsSloPoliciesV1, sloRangeForWindowV1 } from "./slo.ts";

export async function evaluateSignalOpsTenantV1(input: {
  tenantId: string;
  tenantName: string;
}): Promise<{ transitions: number }> {
  const snapshot = await getSignalOpsOpsSnapshotV1({
    ...input,
    range: "24h",
  });
  const policies = await listSignalOpsSloPoliciesV1(input.tenantId);
  // Each SLO is judged on the snapshot covering its own window, not always the last 24 hours.
  const sloSnapshots = new Map<SignalOpsOpsRangeV1, SignalOpsOpsSnapshotV1>([["24h", snapshot]]);
  for (const policy of policies) {
    const range = sloRangeForWindowV1(policy.windowMinutes);
    if (!policy.enabled || sloSnapshots.has(range)) continue;
    sloSnapshots.set(range, await getSignalOpsOpsSnapshotV1({ ...input, range }));
  }
  const synced = await syncSignalOpsIncidentsV1({
    tenantId: input.tenantId,
    decisions: evaluateSignalOpsIncidentsV1(snapshot, policies, sloSnapshots),
  });
  await dispatchSignalOpsIncidentAlertsV1(synced.transitions);
  return { transitions: synced.transitions.length };
}

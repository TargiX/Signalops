import assert from "node:assert/strict";

import {
  evaluateSignalOpsIncidentsV1,
  listSignalOpsIncidentTransitionsV1,
  setSignalOpsIncidentAcknowledgementV1,
  syncSignalOpsIncidentsV1,
} from "../src/lib/signalops/v1/incidents.ts";
import { buildSignalOpsOpsSnapshotV1 } from "../src/lib/signalops/v1/ops-snapshot.ts";
import {
  defaultSignalOpsSloPoliciesV1,
  evaluateSignalOpsSloPoliciesV1,
  listSignalOpsSloPoliciesV1,
  updateSignalOpsSloPolicyV1,
} from "../src/lib/signalops/v1/slo.ts";

delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const tenantId = `slo-test-${crypto.randomUUID()}`;
const now = new Date("2026-08-24T01:00:00.000Z");
const snapshot = buildSignalOpsOpsSnapshotV1({
  tenantId,
  tenantName: "SLO Test",
  range: "24h",
  records: [],
  now,
});
snapshot.totals.operations = 100;
snapshot.totals.succeeded = 94;
snapshot.totals.failed = 6;
snapshot.totals.successRate = 0.94;
snapshot.totals.p95DurationMs = 350_000;
snapshot.totals.operationsWithDuration = 100;
snapshot.coverage.providerAttempts = { observed: 50, total: 100, ratio: 0.5 };
snapshot.coverage.failureClassification = { observed: 5, total: 6, ratio: 5 / 6 };
snapshot.freshness.lastReceivedAt = "2026-08-23T23:00:00.000Z";
snapshot.projection.sourceEventCount = 200;

const defaults = defaultSignalOpsSloPoliciesV1(tenantId);
assert.equal(defaults.length, 5);
assert.equal(defaults.find((policy) => policy.metric === "signal_freshness_ms")?.enabled, false);

const evaluations = evaluateSignalOpsSloPoliciesV1({ snapshot, policies: defaults, now });
assert.deepEqual(
  evaluations.map((evaluation) => [evaluation.policy.metric, evaluation.status, evaluation.severity]),
  [
    ["operation_success_rate", "breached", "critical"],
    ["operation_p95_duration_ms", "breached", "critical"],
    ["provider_attempt_coverage", "breached", "critical"],
    ["failure_classification_coverage", "breached", "warning"],
    ["signal_freshness_ms", "disabled", null],
  ],
);

const lowSample = structuredClone(snapshot);
lowSample.totals.operations = 3;
lowSample.totals.succeeded = 1;
lowSample.totals.failed = 2;
lowSample.coverage.providerAttempts = { observed: 0, total: 3, ratio: 0 };
lowSample.coverage.failureClassification = { observed: 0, total: 2, ratio: 0 };
assert.equal(
  evaluateSignalOpsSloPoliciesV1({ snapshot: lowSample, policies: defaults, now }).find(
    (evaluation) => evaluation.policy.metric === "operation_success_rate",
  )?.status,
  "insufficient_data",
);

const configuredFreshness = await updateSignalOpsSloPolicyV1({
  tenantId,
  policyId: "slo_signal_freshness",
  actorSubject: "operator:test",
  patch: { enabled: true, warningThreshold: 30 * 60_000, criticalThreshold: 90 * 60_000 },
  now,
});
assert.equal(configuredFreshness?.enabled, true);
assert.match(configuredFreshness?.version ?? "", /^tenant-policy-2026-08-24-/);
assert.equal(
  (await listSignalOpsSloPoliciesV1(tenantId)).find(
    (policy) => policy.id === "slo_signal_freshness",
  )?.criticalThreshold,
  90 * 60_000,
);
await assert.rejects(
  updateSignalOpsSloPolicyV1({
    tenantId,
    policyId: "slo_operation_success_rate",
    actorSubject: "operator:test",
    patch: { warningThreshold: 0.5, criticalThreshold: 0.8 },
    now,
  }),
  /invalid_threshold_order/,
);

const decisions = evaluateSignalOpsIncidentsV1(snapshot, defaults).filter((item) =>
  item.metric.startsWith("slo:"),
);
assert.equal(decisions.length, 4);
assert.ok(decisions.every((item) => typeof item.evidence.observedValue === "number"));

const reliability = decisions.find((item) => item.metric === "slo:operation_success_rate");
assert.ok(reliability);
const opened = await syncSignalOpsIncidentsV1({
  tenantId,
  decisions: [reliability],
  now: new Date("2026-08-24T01:01:00.000Z"),
});
assert.equal(opened.transitions.length, 1);
assert.equal(opened.transitions[0].state, "open");
assert.equal(opened.transitions[0].acknowledgedAt, null);

const acknowledged = await setSignalOpsIncidentAcknowledgementV1({
  tenantId,
  incidentId: reliability.id,
  actorSubject: "operator:test",
  acknowledged: true,
  note: "  Investigating\nprovider\u0000route  ",
  now: new Date("2026-08-24T01:02:00.000Z"),
});
assert.equal(acknowledged.changed, true);
assert.equal(acknowledged.incident?.state, "acknowledged");
assert.equal(acknowledged.incident?.acknowledgementNote, "Investigating provider route");

const unacknowledged = await setSignalOpsIncidentAcknowledgementV1({
  tenantId,
  incidentId: reliability.id,
  actorSubject: "operator:test",
  acknowledged: false,
  now: new Date("2026-08-24T01:02:20.000Z"),
});
assert.equal(unacknowledged.changed, true);
assert.equal(unacknowledged.incident?.state, "open");
assert.equal(unacknowledged.incident?.acknowledgementNote, null);

const reassigned = await setSignalOpsIncidentAcknowledgementV1({
  tenantId,
  incidentId: reliability.id,
  actorSubject: "operator:test",
  acknowledged: true,
  note: "Retrying ownership",
  now: new Date("2026-08-24T01:02:40.000Z"),
});
assert.equal(reassigned.changed, true);
assert.equal(reassigned.incident?.state, "acknowledged");

const stable = await syncSignalOpsIncidentsV1({
  tenantId,
  decisions: [reliability],
  now: new Date("2026-08-24T01:03:00.000Z"),
});
assert.equal(stable.transitions.length, 0);
assert.equal(stable.incidents.find((item) => item.id === reliability.id)?.state, "acknowledged");

const resolved = await syncSignalOpsIncidentsV1({
  tenantId,
  decisions: [],
  now: new Date("2026-08-24T01:04:00.000Z"),
});
assert.equal(resolved.transitions[0].state, "resolved");
assert.equal(
  (
    await setSignalOpsIncidentAcknowledgementV1({
      tenantId,
      incidentId: reliability.id,
      actorSubject: "operator:test",
      acknowledged: true,
    })
  ).changed,
  false,
);

const reopened = await syncSignalOpsIncidentsV1({
  tenantId,
  decisions: [reliability],
  now: new Date("2026-08-24T01:05:00.000Z"),
});
assert.equal(reopened.transitions[0].state, "open");
assert.equal(reopened.transitions[0].acknowledgedAt, null);

const warningDecision = { ...reliability, severity: "warning" };
const deescalated = await syncSignalOpsIncidentsV1({
  tenantId,
  decisions: [warningDecision],
  now: new Date("2026-08-24T01:06:00.000Z"),
});
assert.equal(deescalated.transitions.length, 1);
assert.equal(deescalated.transitions[0].severity, "warning");

const escalated = await syncSignalOpsIncidentsV1({
  tenantId,
  decisions: [reliability],
  now: new Date("2026-08-24T01:07:00.000Z"),
});
assert.equal(escalated.transitions.length, 1);
assert.equal(escalated.transitions[0].severity, "critical");

const history = await listSignalOpsIncidentTransitionsV1({
  tenantId,
  incidentId: reliability.id,
});
assert.deepEqual(
  history.map((transition) => transition.type),
  [
    "opened",
    "acknowledged",
    "unacknowledged",
    "acknowledged",
    "resolved",
    "reopened",
    "deescalated",
    "escalated",
  ],
);
assert.equal(history[1].actorSubject, "operator:test");

console.log("signalops SLO and incident lifecycle checks passed");

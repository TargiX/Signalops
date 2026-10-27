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
  evaluateSignalOpsSloPoliciesAdaptiveV1,
  evaluateSignalOpsSloPoliciesV1,
  listSignalOpsSloPoliciesV1,
  sloRangeForWindowV1,
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
snapshot.coverage.operationCostEvidence = { observed: 40, total: 100, ratio: 0.4 };
snapshot.reconciliation = {
  lastReconciledAt: "2026-08-23T12:00:00.000Z",
  currencies: [{ currency: "USD", billed: 3, estimated: 1.5, delta: 1.5 }],
  periods: [0, 1, 2].map((index) => ({
    providerKey: "fal",
    providerVendor: "fal",
    scope: "route_period",
    start: `2026-08-23T0${index + 2}:00:00.000Z`,
    end: `2026-08-23T0${index + 3}:00:00.000Z`,
    billSource: "fal.models.usage",
    currency: "USD",
    billed: 1,
    estimated: 0.5,
    delta: 0.5,
  })),
};

const defaults = defaultSignalOpsSloPoliciesV1(tenantId);
assert.equal(defaults.length, 7);
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
    ["cost_evidence_coverage", "breached", "critical"],
    ["reconciliation_delta_ratio", "breached", "warning"],
  ],
);

const lowSample = structuredClone(snapshot);
lowSample.totals.operations = 3;
lowSample.totals.succeeded = 1;
lowSample.totals.failed = 2;
lowSample.coverage.providerAttempts = { observed: 0, total: 3, ratio: 0 };
lowSample.coverage.failureClassification = { observed: 0, total: 2, ratio: 0 };
lowSample.coverage.operationCostEvidence = { observed: 0, total: 3, ratio: 0 };
lowSample.reconciliation = { lastReconciledAt: null, currencies: [], periods: [] };
assert.equal(
  evaluateSignalOpsSloPoliciesV1({ snapshot: lowSample, policies: defaults, now }).find(
    (evaluation) => evaluation.policy.metric === "operation_success_rate",
  )?.status,
  "insufficient_data",
);

// Customer-caused failures leave the reliability sample: 23 ok + 2 content-policy blocks is met,
// and no reliability incident opens.
const customerCaused = structuredClone(snapshot);
customerCaused.totals.operations = 25;
customerCaused.totals.succeeded = 23;
customerCaused.totals.failed = 2;
customerCaused.totals.successRate = 23 / 25;
customerCaused.totals.failedByResponsibility = { provider: 0, platform: 0, client: 0, customer: 2, unknown: 0 };
const dailyPolicies = defaults.map((policy) =>
  policy.metric === "operation_success_rate"
    ? { ...policy, minimumSample: 20, windowMinutes: 1_440 }
    : policy,
);
const customerCausedReliability = evaluateSignalOpsSloPoliciesV1({
  snapshot: customerCaused,
  policies: dailyPolicies,
  now,
}).find((evaluation) => evaluation.policy.metric === "operation_success_rate");
assert.equal(customerCausedReliability?.status, "met");
assert.equal(customerCausedReliability?.observedValue, 1);
assert.equal(customerCausedReliability?.sampleSize, 23);
assert.equal(
  evaluateSignalOpsIncidentsV1(customerCaused, dailyPolicies).some(
    (item) => item.metric === "slo:operation_success_rate",
  ),
  false,
);

// Display evaluation widens the window for low-volume tenants instead of hiding data.
const bySampleRange = {
  "24h": { succeeded: 3, failed: 0, durations: 3 },
  "7d": { succeeded: 60, failed: 0, durations: 60 },
  "30d": { succeeded: 60, failed: 12, durations: 72 },
  "90d": { succeeded: 90, failed: 20, durations: 110 },
};
const loadedRanges = [];
const adaptive = await evaluateSignalOpsSloPoliciesAdaptiveV1({
  policies: defaults,
  now,
  loadSnapshot: async (range) => {
    loadedRanges.push(range);
    const ranged = structuredClone(snapshot);
    const sample = bySampleRange[range];
    ranged.range = range;
    ranged.totals.succeeded = sample.succeeded;
    ranged.totals.failed = sample.failed;
    ranged.totals.successRate = sample.succeeded / (sample.succeeded + sample.failed);
    ranged.totals.operationsWithDuration = sample.durations;
    ranged.totals.p95DurationMs = 30_000;
    ranged.coverage.providerAttempts = { observed: sample.durations, total: sample.durations, ratio: 1 };
    ranged.coverage.failureClassification =
      range === "90d" ? { observed: 3, total: 4, ratio: 0.75 } : { observed: 0, total: 0, ratio: null };
    return ranged;
  },
});
const adaptiveBy = Object.fromEntries(adaptive.map((evaluation) => [evaluation.policy.metric, evaluation]));
assert.equal(adaptiveBy.operation_success_rate.evaluatedRange, "7d");
assert.equal(adaptiveBy.operation_success_rate.status, "met");
assert.equal(adaptiveBy.operation_success_rate.lowSample, false);
assert.equal(adaptiveBy.operation_success_rate.sampleSize, 60);
assert.equal(adaptiveBy.operation_p95_duration_ms.evaluatedRange, "7d");
assert.equal(
  adaptiveBy.failure_classification_coverage.evaluatedRange,
  "90d",
  "A sample below the minimum is still judged on the widest window that has data.",
);
assert.equal(adaptiveBy.failure_classification_coverage.lowSample, true);
assert.equal(adaptiveBy.failure_classification_coverage.status, "breached");
assert.equal(adaptiveBy.signal_freshness_ms.status, "disabled");
assert.ok(adaptive.every((evaluation) => evaluation.status !== "insufficient_data"));
assert.deepEqual([...new Set(loadedRanges)].sort(), ["24h", "30d", "7d", "90d"]);

const emptyAdaptive = await evaluateSignalOpsSloPoliciesAdaptiveV1({
  policies: defaults.filter((policy) => policy.metric === "operation_success_rate"),
  now,
  loadSnapshot: async () => buildSignalOpsOpsSnapshotV1({ tenantId, range: "24h", records: [], now }),
});
assert.equal(emptyAdaptive[0].status, "insufficient_data", "No data at all stays insufficient.");

const busyLoads = [];
await evaluateSignalOpsSloPoliciesAdaptiveV1({
  policies: defaults.filter((policy) => policy.metric === "operation_success_rate"),
  now,
  loadSnapshot: async (range) => {
    busyLoads.push(range);
    return snapshot;
  },
});
assert.deepEqual(busyLoads, ["7d"], "A busy tenant loads only the policy window.");

// Incident evaluation judges each SLO on the snapshot that covers its own window.
assert.equal(sloRangeForWindowV1(1_440), "24h");
assert.equal(sloRangeForWindowV1(10_080), "7d");
assert.equal(sloRangeForWindowV1(10_081), "30d");
assert.equal(sloRangeForWindowV1(1_000_000), "90d");
const reliabilityDefault = defaults.find((policy) => policy.metric === "operation_success_rate");
assert.equal(reliabilityDefault.windowMinutes, 10_080);
assert.equal(reliabilityDefault.minimumSample, 50);
// A low-volume day with one provider failure (24 ok + 1) breaches nothing on its own...
const quietDay = structuredClone(snapshot);
quietDay.totals.succeeded = 24;
quietDay.totals.failed = 1;
quietDay.totals.failedByResponsibility = { provider: 1, platform: 0, client: 0, customer: 0, unknown: 0 };
const quietWeek = structuredClone(quietDay);
quietWeek.range = "7d";
quietWeek.totals.succeeded = 172;
quietWeek.totals.failed = 3;
quietWeek.totals.failedByResponsibility = { provider: 1, platform: 0, client: 0, customer: 2, unknown: 0 };
const reliabilityOnly = [reliabilityDefault];
assert.equal(
  evaluateSignalOpsIncidentsV1(quietDay, reliabilityOnly, new Map([["7d", quietWeek]])).length,
  0,
  "172/173 over seven days meets the objective.",
);
// ...while a week that really degrades still opens a critical incident.
const badWeek = structuredClone(quietWeek);
badWeek.totals.failed = 12;
badWeek.totals.failedByResponsibility = { provider: 10, platform: 0, client: 0, customer: 2, unknown: 0 };
const [badWeekDecision] = evaluateSignalOpsIncidentsV1(quietDay, reliabilityOnly, new Map([["7d", badWeek]]));
assert.equal(badWeekDecision.metric, "slo:operation_success_rate");
assert.equal(badWeekDecision.severity, "critical");
assert.equal(badWeekDecision.evidence.sampleSize, 182);

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
assert.equal(decisions.length, 6);
assert.ok(decisions.every((item) => typeof item.evidence.observedValue === "number"));
assert.ok(decisions.some((item) => item.metric === "slo:cost_evidence_coverage"));
assert.ok(decisions.some((item) => item.metric === "slo:reconciliation_delta_ratio"));

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

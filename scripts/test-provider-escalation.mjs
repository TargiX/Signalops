import assert from "node:assert/strict";

import { buildProviderEscalation } from "../src/lib/provider-escalation.ts";

const base = {
  incident: {
    id: "inc_409",
    title: "fal queue stalls on video jobs",
    severity: "critical",
  },
  provider: {
    name: "fal",
    region: "us-east",
    p95Ms: 4230,
    failureRate: 9.14,
  },
  affectedJobCount: 137,
  guard: "latency",
  trafficShare: 30,
  decisionState: "proposed",
  projected: {
    movedJobs: 41,
    p95Ms: 1800,
    failureRate: 2.5,
  },
  canonicalUrl: "https://signalops.example/incidents/inc_409",
};

const draft = buildProviderEscalation(base);

// Subject pins severity uppercased and the incident id.
assert.match(draft, /^Subject: \[CRITICAL\] fal assistance requested — inc_409\n/);

// Metrics keep the shared formatting contract: p95 in seconds with one
// decimal, failure rate with one decimal, jobs as a raw count.
assert.match(
  draft,
  /Current signal: p95 4\.2s · failure rate 9\.1% · 137 affected jobs\./,
);
assert.match(
  draft,
  /Projected after mitigation: 41 jobs moved · p95 1\.8s · failure rate 2\.5%\./,
);

// The guard names the condition the decision was made on.
assert.match(draft, /Mitigation condition: p95 latency\./);

// A draft never claims a production routing change.
assert.match(
  draft,
  /Routing status: DRAFT ONLY — we are evaluating a 30% traffic drain and have not changed production routing\./,
);
assert.ok(!draft.includes("ACTIVE"));
assert.ok(!draft.includes("PREVIEW ONLY"));

// The incident reference must be present so support can reply to a thread.
assert.match(draft, /Incident reference: https:\/\/signalops\.example\/incidents\/inc_409/);

// Failure-rate guard names its own condition.
const failureDraft = buildProviderEscalation({
  ...base,
  guard: "failure",
});
assert.match(failureDraft, /Mitigation condition: failure rate\./);

// A simulation stays a preview and never claims applied traffic.
const simulated = buildProviderEscalation({
  ...base,
  decisionState: "simulated",
});
assert.match(
  simulated,
  /PREVIEW ONLY — we simulated draining 30% of matching traffic; no production routing change has been applied\./,
);
assert.ok(!simulated.includes("ACTIVE —"));

// An applied rule states what was drained and when it was applied.
const applied = buildProviderEscalation({
  ...base,
  decisionState: "applied",
  appliedAt: "2026-11-23T03:12:00.000Z",
});
assert.match(
  applied,
  /ACTIVE — we drained 30% of matching traffic at 2026-11-23T03:12:00\.000Z\./,
);

// A missing appliedAt still reads as ACTIVE with the snapshot-time fallback.
const appliedNoTimestamp = buildProviderEscalation({
  ...base,
  decisionState: "applied",
});
assert.match(
  appliedNoTimestamp,
  /ACTIVE — we drained 30% of matching traffic at the current snapshot time\./,
);

console.log(
  "Provider escalation contract OK: pins routing-status wording per decision state, metric formatting and the incident reference.",
);

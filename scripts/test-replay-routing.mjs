import assert from "node:assert/strict";

import { resolveReplayRoutingReconcile } from "../src/lib/replay-routing.ts";

// Minimal structural fixtures — the same shape the dashboard's
// replayScenarios carry (id + steps with state.routingApplied).
const scenarios = [
  {
    id: "alibaba-p95",
    steps: [
      { state: { routingApplied: false } },
      { state: { routingApplied: false } },
      { state: { routingApplied: true } },
    ],
  },
  {
    id: "openrouter-cost",
    steps: [{ state: { routingApplied: true } }],
  },
];

// No deep link — nothing to reconcile.
assert.equal(
  resolveReplayRoutingReconcile({
    scenarios,
    scenarioId: null,
    stepIndex: 0,
    range: "24h",
    appliedKey: null,
  }),
  null,
);

// Unknown scenario id — the snapshot arrived before the link was validated.
assert.equal(
  resolveReplayRoutingReconcile({
    scenarios,
    scenarioId: "does-not-exist",
    stepIndex: 0,
    range: "24h",
    appliedKey: null,
  }),
  null,
);

// Out-of-range deep-linked step clamps to the last step, and the routing key
// records the bounded index (not the raw URL value).
const clamped = resolveReplayRoutingReconcile({
  scenarios,
  scenarioId: "alibaba-p95",
  stepIndex: 99,
  range: "24h",
  appliedKey: null,
});
assert.ok(clamped);
assert.equal(clamped.scenario.id, "alibaba-p95");
assert.equal(clamped.step.state.routingApplied, true);
assert.equal(clamped.routingKey, "24h:alibaba-p95:2");

// Negative step clamps to the first step.
const negative = resolveReplayRoutingReconcile({
  scenarios,
  scenarioId: "alibaba-p95",
  stepIndex: -3,
  range: "24h",
  appliedKey: null,
});
assert.ok(negative);
assert.equal(negative.step.state.routingApplied, false);
assert.equal(negative.routingKey, "24h:alibaba-p95:0");

// Steps with routingApplied: false still produce a decision — the caller
// clears the stale optimistic rule; the decision only describes the target.
const unapplied = resolveReplayRoutingReconcile({
  scenarios,
  scenarioId: "alibaba-p95",
  stepIndex: 1,
  range: "7d",
  appliedKey: null,
});
assert.ok(unapplied);
assert.equal(unapplied.step.state.routingApplied, false);
assert.equal(unapplied.routingKey, "7d:alibaba-p95:1");

// Already applied for this exact range/scenario/step — no re-application.
assert.equal(
  resolveReplayRoutingReconcile({
    scenarios,
    scenarioId: "alibaba-p95",
    stepIndex: 1,
    range: "7d",
    appliedKey: "7d:alibaba-p95:1",
  }),
  null,
);

// A range change re-arms reconciliation even for the same scenario/step.
const rangeChanged = resolveReplayRoutingReconcile({
  scenarios,
  scenarioId: "alibaba-p95",
  stepIndex: 1,
  range: "24h",
  appliedKey: "7d:alibaba-p95:1",
});
assert.ok(rangeChanged);
assert.equal(rangeChanged.routingKey, "24h:alibaba-p95:1");

// Single-step scenario still resolves.
const single = resolveReplayRoutingReconcile({
  scenarios,
  scenarioId: "openrouter-cost",
  stepIndex: 0,
  range: "24h",
  appliedKey: null,
});
assert.ok(single);
assert.equal(single.routingKey, "24h:openrouter-cost:0");

// Scenario with no steps never produces a decision.
assert.equal(
  resolveReplayRoutingReconcile({
    scenarios: [{ id: "empty", steps: [] }],
    scenarioId: "empty",
    stepIndex: 0,
    range: "24h",
    appliedKey: null,
  }),
  null,
);

console.log("replay routing reconcile logic: all assertions passed");

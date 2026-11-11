// Pure decision logic for reconciling the replay routing rule with the ops
// snapshot. The Dashboard re-applies the routing rule once per
// range/scenario/step after the snapshot arrives — without this, a deep-linked
// replay (?replay=<id>&step=<n>) lost its routing rule on first load because
// the mount effect ran before any snapshot was cached (fixed in 36e2c76).
// Extracted here so scripts/test-replay-routing.mjs can regression-test the
// same reconciliation the cockpit runs in the browser.

export type ReplayRoutingScenario = {
  id: string;
  steps: readonly { state: { routingApplied: boolean } }[];
};

export type ReplayRoutingDecision<S extends ReplayRoutingScenario> = {
  scenario: S;
  step: S["steps"][number];
  routingKey: string;
} | null;

export function replayRoutingKey(
  range: string,
  scenarioId: string,
  stepIndex: number,
): string {
  return `${range}:${scenarioId}:${stepIndex}`;
}

export function resolveReplayRoutingReconcile<
  S extends ReplayRoutingScenario,
>(input: {
  scenarios: readonly S[];
  scenarioId: string | null;
  stepIndex: number;
  range: string;
  appliedKey: string | null;
}): ReplayRoutingDecision<S> {
  const { scenarios, scenarioId, stepIndex, range, appliedKey } = input;

  if (!scenarioId) {
    return null;
  }

  const scenario = scenarios.find((item) => item.id === scenarioId);

  if (!scenario) {
    return null;
  }

  const boundedIndex = Math.max(
    0,
    Math.min(stepIndex, scenario.steps.length - 1),
  );
  const step = scenario.steps[boundedIndex];

  if (!step) {
    return null;
  }

  const routingKey = replayRoutingKey(range, scenario.id, boundedIndex);

  // Already applied for this exact snapshot window — do not re-apply.
  if (routingKey === appliedKey) {
    return null;
  }

  return { scenario, step, routingKey };
}

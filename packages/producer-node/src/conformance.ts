import type { SignalOpsEventV1 } from "@signalops/contracts/v1";

export type SignalOpsProducerConformanceScenarioV1 = Readonly<{
  name: "success" | "failure";
  source: string;
  resource: { environment: string; service: string; release: string };
  operation: { id: string; kind: "image_generation"; logicalModelKey: string };
  attempt: { id: string; number: 1 };
  route: {
    providerKey: string;
    providerVendor: string;
    modelKey: string;
    providerModelKey: string;
    region: string;
  };
  acceptedAt: string;
  attemptStartedAt: string;
  attemptTerminalAt: string;
  operationTerminalAt: string;
  traceparent: string;
  privateCanary: string;
  secretCanary: string;
}>;

export type SignalOpsProducerConformanceHarnessV1 = (
  scenario: SignalOpsProducerConformanceScenarioV1,
) => Promise<readonly unknown[]>;

export type SignalOpsProducerConformanceIssueV1 = Readonly<{
  scenario: string;
  code: string;
  message: string;
}>;

export type SignalOpsProducerConformanceResultV1 = Readonly<{
  ok: boolean;
  scenarios: number;
  events: number;
  issues: readonly SignalOpsProducerConformanceIssueV1[];
}>;

const baseScenario = {
  source: "https://producer.example.test/generation-worker",
  resource: {
    environment: "conformance",
    service: "generation-worker",
    release: "conformance-v1",
  },
  operation: {
    id: "conformance-operation-001",
    kind: "image_generation" as const,
    logicalModelKey: "image-balanced",
  },
  attempt: { id: "conformance-attempt-001", number: 1 as const },
  route: {
    providerKey: "primary-images",
    providerVendor: "example-provider",
    modelKey: "image-balanced",
    providerModelKey: "images-v1",
    region: "global",
  },
  acceptedAt: "2026-08-23T12:00:00.000Z",
  attemptStartedAt: "2026-08-23T12:00:01.000Z",
  attemptTerminalAt: "2026-08-23T12:00:03.000Z",
  operationTerminalAt: "2026-08-23T12:00:04.000Z",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  privateCanary: "conformance-user@example.test",
  secretCanary: "Bearer conformance-secret-do-not-emit",
};

export const SIGNALOPS_PRODUCER_CONFORMANCE_SCENARIOS_V1: readonly SignalOpsProducerConformanceScenarioV1[] = [
  { ...baseScenario, name: "success" },
  {
    ...baseScenario,
    name: "failure",
    operation: { ...baseScenario.operation, id: "conformance-operation-002" },
    attempt: { ...baseScenario.attempt, id: "conformance-attempt-002" },
  },
];

function isEvent(value: unknown): value is SignalOpsEventV1 {
  return Boolean(value && typeof value === "object" && "type" in value && "data" in value);
}

function addIssue(
  issues: SignalOpsProducerConformanceIssueV1[],
  scenario: string,
  code: string,
  message: string,
): void {
  issues.push({ scenario, code, message });
}

export async function runSignalOpsProducerConformanceV1(input: {
  capture: SignalOpsProducerConformanceHarnessV1;
  validate: (event: unknown) => { ok: boolean };
}): Promise<SignalOpsProducerConformanceResultV1> {
  const issues: SignalOpsProducerConformanceIssueV1[] = [];
  let eventCount = 0;

  for (const scenario of SIGNALOPS_PRODUCER_CONFORMANCE_SCENARIOS_V1) {
    const [firstRaw, secondRaw] = await Promise.all([
      input.capture(structuredClone(scenario)),
      input.capture(structuredClone(scenario)),
    ]);
    const first = firstRaw.filter(isEvent);
    const second = secondRaw.filter(isEvent);
    eventCount += first.length;
    if (first.length !== firstRaw.length) {
      addIssue(issues, scenario.name, "non_event_output", "Harness returned a non-event value.");
    }
    if (first.length !== 4) {
      addIssue(issues, scenario.name, "boundary_count", `Expected 4 lifecycle events, received ${first.length}.`);
    }

    const types = new Map(first.map((event) => [event.type, event]));
    for (const type of [
      "com.signalops.ai.operation.accepted.v1",
      "com.signalops.ai.attempt.started.v1",
      "com.signalops.ai.attempt.terminal.v1",
      "com.signalops.ai.operation.terminal.v1",
    ] as const) {
      if (first.filter((event) => event.type === type).length !== 1) {
        addIssue(issues, scenario.name, "boundary_identity", `Expected exactly one ${type}.`);
      }
    }

    for (const event of [...first].reverse()) {
      if (!input.validate(event).ok) {
        addIssue(issues, scenario.name, "contract_rejection", `${event.type} failed canonical validation.`);
      }
      if (event.subject !== `operation/${scenario.operation.id}`) {
        addIssue(issues, scenario.name, "subject_mismatch", `${event.type} has the wrong subject.`);
      }
      const serialized = JSON.stringify(event);
      if (serialized.includes(scenario.privateCanary) || serialized.includes(scenario.secretCanary)) {
        addIssue(issues, scenario.name, "privacy_canary", `${event.type} leaked a privacy canary.`);
      }
    }

    const ids = first.map((event) => event.id).sort();
    const repeatIds = second.filter(isEvent).map((event) => event.id).sort();
    if (JSON.stringify(ids) !== JSON.stringify(repeatIds)) {
      addIssue(issues, scenario.name, "unstable_event_ids", "Repeated fixed input produced different event IDs.");
    }
    if (new Set(ids).size !== ids.length) {
      addIssue(issues, scenario.name, "duplicate_boundary_ids", "Lifecycle boundaries reused an event ID.");
    }

    const attemptStarted = types.get("com.signalops.ai.attempt.started.v1");
    const attemptTerminal = types.get("com.signalops.ai.attempt.terminal.v1");
    const operationTerminal = types.get("com.signalops.ai.operation.terminal.v1");
    if (
      attemptStarted?.type === "com.signalops.ai.attempt.started.v1" &&
      JSON.stringify(attemptStarted.data.route) !== JSON.stringify(scenario.route)
    ) {
      addIssue(issues, scenario.name, "route_mismatch", "Attempt route was not preserved.");
    }
    if (
      attemptTerminal?.type === "com.signalops.ai.attempt.terminal.v1" &&
      attemptTerminal.data.metrics?.durationMs !== 2_000
    ) {
      addIssue(issues, scenario.name, "attempt_duration", "Attempt duration was not recorded or inferred.");
    }
    if (
      operationTerminal?.type === "com.signalops.ai.operation.terminal.v1" &&
      operationTerminal.data.metrics?.totalDurationMs !== 4_000
    ) {
      addIssue(issues, scenario.name, "operation_duration", "Operation duration was not recorded or inferred.");
    }

    if (scenario.name === "success") {
      if (
        attemptTerminal?.type !== "com.signalops.ai.attempt.terminal.v1" ||
        attemptTerminal.data.outcome.status !== "succeeded" ||
        operationTerminal?.type !== "com.signalops.ai.operation.terminal.v1" ||
        operationTerminal.data.outcome.status !== "succeeded"
      ) {
        addIssue(issues, scenario.name, "success_outcome", "Success lifecycle lost its terminal outcome.");
      }
    } else if (
      attemptTerminal?.type !== "com.signalops.ai.attempt.terminal.v1" ||
      attemptTerminal.data.outcome.status !== "failed" ||
      attemptTerminal.data.outcome.failure.category !== "provider_timeout" ||
      attemptTerminal.data.outcome.failure.responsibility !== "provider" ||
      operationTerminal?.type !== "com.signalops.ai.operation.terminal.v1" ||
      operationTerminal.data.outcome.status !== "failed"
    ) {
      addIssue(issues, scenario.name, "failure_outcome", "Failure lifecycle was not normalized.");
    }
  }

  return {
    ok: issues.length === 0,
    scenarios: SIGNALOPS_PRODUCER_CONFORMANCE_SCENARIOS_V1.length,
    events: eventCount,
    issues,
  };
}

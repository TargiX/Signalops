import type { StoredSignalOpsEventV1 } from "./event-store.ts";
import type {
  SignalOpsAttemptV1,
  SignalOpsCostV1,
  SignalOpsEventV1,
  SignalOpsFailureV1,
  SignalOpsResourceV1,
  SignalOpsRouteV1,
  SignalOpsTerminalStatusV1,
} from "./types.ts";

type OperationEventV1 = Exclude<
  SignalOpsEventV1,
  { type: "com.signalops.ai.provider.probe.v1" }
>;

type OperationAcceptedEventV1 = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.operation.accepted.v1" }
>;

type OperationTerminalEventV1 = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.operation.terminal.v1" }
>;

type AttemptStartedEventV1 = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.attempt.started.v1" }
>;

type AttemptTerminalEventV1 = Extract<
  SignalOpsEventV1,
  { type: "com.signalops.ai.attempt.terminal.v1" }
>;

type AttemptStateV1 = {
  identity: SignalOpsAttemptV1;
  started?: AttemptStartedEventV1;
  terminal?: AttemptTerminalEventV1;
};

export type SignalOpsOperationTraceAttemptV1 = {
  id: string;
  number: number;
  status: SignalOpsTerminalStatusV1 | "running";
  startedAt: string | null;
  terminalAt: string | null;
  durationMs: number | null;
  queueDurationMs: number | null;
  outputUnits: number | null;
  route: SignalOpsRouteV1;
  resource: SignalOpsResourceV1;
  failure?: SignalOpsFailureV1;
  cost?: SignalOpsCostV1;
  traceparent?: string;
  telemetry: { startedSeen: boolean; terminalSeen: boolean };
};

export type SignalOpsOperationTraceV1 = {
  tenantId: string;
  operation: {
    id: string;
    kind: string;
    logicalModelKey?: string;
    status: SignalOpsTerminalStatusV1 | "running";
    acceptedAt: string | null;
    terminalAt: string | null;
    durationMs: number | null;
    resource: SignalOpsResourceV1;
    failure?: SignalOpsFailureV1;
  };
  attempts: SignalOpsOperationTraceAttemptV1[];
  events: Array<{
    eventId: string;
    type: SignalOpsEventV1["type"];
    occurredAt: string;
    receivedAt: string;
    traceparent?: string;
  }>;
  telemetry: {
    complete: boolean;
    truncated: boolean;
    acceptedSeen: boolean;
    operationTerminalSeen: boolean;
    attemptStarts: number;
    attemptTerminals: number;
    pairedAttempts: number;
    missingAttemptStarts: number;
    missingAttemptTerminals: number;
    contradictoryTerminals: number;
    identityCollisions: number;
  };
};

const operationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u;

export function isSignalOpsOperationIdV1(value: string): boolean {
  return operationIdPattern.test(value);
}

function compareRecordsV1(
  left: StoredSignalOpsEventV1,
  right: StoredSignalOpsEventV1,
): number {
  return (
    left.event.time.localeCompare(right.event.time) ||
    left.receivedAt.localeCompare(right.receivedAt) ||
    left.event.id.localeCompare(right.event.id)
  );
}

function durationBetweenV1(start: string | undefined, end: string): number | null {
  if (!start) return null;
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

function terminalFailureV1(
  event: OperationTerminalEventV1 | AttemptTerminalEventV1 | undefined,
): SignalOpsFailureV1 | undefined {
  if (!event || event.data.outcome.status === "succeeded") return undefined;
  return event.data.outcome.failure;
}

export function buildSignalOpsOperationTraceV1(input: {
  tenantId: string;
  operationId: string;
  records: readonly StoredSignalOpsEventV1[];
  sourceTruncated?: boolean;
}): SignalOpsOperationTraceV1 | null {
  const subject = `operation/${input.operationId}`;
  const records = input.records
    .filter(
      (record) =>
        record.tenantId === input.tenantId &&
        record.event.subject === subject &&
        record.event.type !== "com.signalops.ai.provider.probe.v1",
    )
    .sort(compareRecordsV1);
  if (records.length === 0) return null;

  let source: OperationEventV1 | undefined;
  let accepted: OperationAcceptedEventV1 | undefined;
  let terminal: OperationTerminalEventV1 | undefined;
  let operationSignature: string | undefined;
  let contradictoryTerminals = 0;
  let identityCollisions = 0;
  const attempts = new Map<string, AttemptStateV1>();
  const attemptSignatures = new Map<string, string>();

  for (const record of records) {
    const event = record.event as OperationEventV1;
    if (event.data.operation.id !== input.operationId) {
      identityCollisions += 1;
      continue;
    }
    const nextOperationSignature = [
      event.data.operation.kind,
      event.data.operation.logicalModelKey ?? "",
    ].join("\u0000");
    if (operationSignature && operationSignature !== nextOperationSignature) {
      identityCollisions += 1;
      continue;
    }
    operationSignature = nextOperationSignature;
    source ??= event;

    if (event.type === "com.signalops.ai.operation.accepted.v1") {
      accepted ??= event;
      continue;
    }
    if (event.type === "com.signalops.ai.operation.terminal.v1") {
      if (terminal) contradictoryTerminals += 1;
      else terminal = event;
      continue;
    }

    const attemptSignature = [
      event.data.attempt.number,
      event.data.route.providerKey,
      event.data.route.modelKey,
    ].join("\u0000");
    const knownAttemptSignature = attemptSignatures.get(event.data.attempt.id);
    if (knownAttemptSignature && knownAttemptSignature !== attemptSignature) {
      identityCollisions += 1;
      continue;
    }
    attemptSignatures.set(event.data.attempt.id, attemptSignature);
    const state = attempts.get(event.data.attempt.id) ?? {
      identity: event.data.attempt,
    };
    if (event.type === "com.signalops.ai.attempt.started.v1") {
      state.started ??= event;
    } else if (state.terminal) {
      contradictoryTerminals += 1;
    } else {
      state.terminal = event;
    }
    attempts.set(event.data.attempt.id, state);
  }

  const operationEvent = terminal ?? accepted ?? source;
  if (!operationEvent) return null;
  const traceAttempts = [...attempts.values()]
    .map((state): SignalOpsOperationTraceAttemptV1 => {
      const event = state.terminal ?? state.started;
      if (!event) throw new Error(`attempt ${state.identity.id} has no lifecycle event`);
      return {
        id: state.identity.id,
        number: state.identity.number,
        status: state.terminal ? state.terminal.data.outcome.status : "running",
        startedAt: state.started?.time ?? null,
        terminalAt: state.terminal?.time ?? null,
        durationMs:
          state.terminal?.data.metrics?.durationMs ??
          (state.terminal
            ? durationBetweenV1(state.started?.time, state.terminal.time)
            : null),
        queueDurationMs: state.terminal?.data.metrics?.queueDurationMs ?? null,
        outputUnits: state.terminal?.data.metrics?.outputUnits ?? null,
        route: structuredClone(event.data.route),
        resource: structuredClone(event.data.resource),
        failure: terminalFailureV1(state.terminal),
        cost: state.terminal?.data.cost
          ? structuredClone(state.terminal.data.cost)
          : undefined,
        traceparent: state.started?.traceparent ?? state.terminal?.traceparent,
        telemetry: {
          startedSeen: Boolean(state.started),
          terminalSeen: Boolean(state.terminal),
        },
      };
    })
    .sort(
      (left, right) =>
        left.number - right.number ||
        (left.startedAt ?? left.terminalAt ?? "").localeCompare(
          right.startedAt ?? right.terminalAt ?? "",
        ) ||
        left.id.localeCompare(right.id),
    );

  const attemptStarts = traceAttempts.filter((attempt) => attempt.telemetry.startedSeen).length;
  const attemptTerminals = traceAttempts.filter((attempt) => attempt.telemetry.terminalSeen).length;
  const pairedAttempts = traceAttempts.filter(
    (attempt) => attempt.telemetry.startedSeen && attempt.telemetry.terminalSeen,
  ).length;
  const missingAttemptStarts = traceAttempts.length - attemptStarts;
  const missingAttemptTerminals = traceAttempts.length - attemptTerminals;
  const truncated = input.sourceTruncated ?? false;

  return {
    tenantId: input.tenantId,
    operation: {
      id: input.operationId,
      kind: operationEvent.data.operation.kind,
      logicalModelKey: operationEvent.data.operation.logicalModelKey,
      status: terminal ? terminal.data.outcome.status : "running",
      acceptedAt: accepted?.time ?? null,
      terminalAt: terminal?.time ?? null,
      durationMs:
        terminal?.data.metrics?.totalDurationMs ??
        (terminal ? durationBetweenV1(accepted?.time, terminal.time) : null),
      resource: structuredClone(operationEvent.data.resource),
      failure: terminalFailureV1(terminal),
    },
    attempts: traceAttempts,
    events: records.map((record) => ({
      eventId: record.event.id,
      type: record.event.type,
      occurredAt: record.event.time,
      receivedAt: record.receivedAt,
      traceparent: record.event.traceparent,
    })),
    telemetry: {
      complete:
        Boolean(accepted) &&
        Boolean(terminal) &&
        missingAttemptStarts === 0 &&
        missingAttemptTerminals === 0 &&
        contradictoryTerminals === 0 &&
        identityCollisions === 0 &&
        !truncated,
      truncated,
      acceptedSeen: Boolean(accepted),
      operationTerminalSeen: Boolean(terminal),
      attemptStarts,
      attemptTerminals,
      pairedAttempts,
      missingAttemptStarts,
      missingAttemptTerminals,
      contradictoryTerminals,
      identityCollisions,
    },
  };
}

import { createHash } from "node:crypto";

import {
  SIGNALOPS_V1_SCHEMA_URL,
  type SignalOpsAttributesV1,
  type SignalOpsAttemptV1,
  type SignalOpsCostV1,
  type SignalOpsEventTypeV1,
  type SignalOpsEventV1,
  type SignalOpsOperationV1,
  type SignalOpsProbeRouteV1,
  type SignalOpsResourceV1,
  type SignalOpsRouteV1,
  type SignalOpsTerminalOutcomeV1,
  type SignalOpsTerminalStatusV1,
} from "@signalops/contracts/v1";

import {
  normalizeSignalOpsFailureV1,
  sanitizeSignalOpsAttributesV1,
} from "./privacy.js";
import {
  emptySignalOpsDeliveryReportV1,
  type SignalOpsDeliveryReportV1,
  type SignalOpsProducerTransportV1,
} from "./transport.js";

export type SignalOpsTimestampInputV1 = Date | string;

export type SignalOpsProducerDiagnosticCodeV1 =
  | "attributes_dropped"
  | "conflicting_attempt_identity"
  | "conflicting_terminal_ignored"
  | "transport_close_failed"
  | "transport_enqueue_failed"
  | "transport_flush_failed";

export type SignalOpsProducerDiagnosticV1 = Readonly<{
  code: SignalOpsProducerDiagnosticCodeV1;
  eventId?: string;
  eventType?: SignalOpsEventTypeV1;
  operationId?: string;
  attemptId?: string;
  droppedAttributeCount?: number;
}>;

export type SignalOpsRecordResultV1 = Readonly<{
  status: "enqueued" | "duplicate" | "conflict" | "dropped";
  eventId: string;
}>;

export type SignalOpsOutcomeInputV1 = Readonly<{
  status: SignalOpsTerminalStatusV1;
  failure?: unknown;
}>;

export type SignalOpsStartOperationInputV1 = Readonly<{
  operation: SignalOpsOperationV1;
  time?: SignalOpsTimestampInputV1;
  traceparent?: string;
  attributes?: SignalOpsAttributesV1;
}>;

export type SignalOpsStartAttemptInputV1 = Readonly<{
  attempt: SignalOpsAttemptV1;
  route: SignalOpsRouteV1;
  time?: SignalOpsTimestampInputV1;
  traceparent?: string;
  attributes?: SignalOpsAttributesV1;
}>;

export type SignalOpsAttemptFinishOptionsV1 = Readonly<{
  time?: SignalOpsTimestampInputV1;
  traceparent?: string;
  metrics?: {
    durationMs?: number;
    queueDurationMs?: number;
    outputUnits?: number;
  };
  cost?: SignalOpsCostV1;
  attributes?: SignalOpsAttributesV1;
}>;

export type SignalOpsAttemptFinishInputV1 = SignalOpsAttemptFinishOptionsV1 &
  Readonly<{ outcome: SignalOpsOutcomeInputV1 }>;

export type SignalOpsOperationFinishOptionsV1 = Readonly<{
  time?: SignalOpsTimestampInputV1;
  traceparent?: string;
  metrics?: {
    totalDurationMs?: number;
    attemptCount?: number;
  };
  attributes?: SignalOpsAttributesV1;
}>;

export type SignalOpsOperationFinishInputV1 = SignalOpsOperationFinishOptionsV1 &
  Readonly<{ outcome: SignalOpsOutcomeInputV1 }>;

export type SignalOpsProviderProbeInputV1 = Readonly<{
  route: SignalOpsProbeRouteV1;
  outcome: { status: "succeeded" } | { status: "failed"; failure?: unknown };
  time?: SignalOpsTimestampInputV1;
  traceparent?: string;
  metrics?: { durationMs?: number };
  attributes?: SignalOpsAttributesV1;
}>;

export interface SignalOpsAttemptHandleV1 {
  readonly id: string;
  readonly number: number;
  readonly startedEventId: string;
  finish(input: SignalOpsAttemptFinishInputV1): SignalOpsRecordResultV1;
  succeed(options?: SignalOpsAttemptFinishOptionsV1): SignalOpsRecordResultV1;
  fail(failure?: unknown, options?: SignalOpsAttemptFinishOptionsV1): SignalOpsRecordResultV1;
  cancel(failure?: unknown, options?: SignalOpsAttemptFinishOptionsV1): SignalOpsRecordResultV1;
  expire(failure?: unknown, options?: SignalOpsAttemptFinishOptionsV1): SignalOpsRecordResultV1;
  abandon(failure?: unknown, options?: SignalOpsAttemptFinishOptionsV1): SignalOpsRecordResultV1;
}

export interface SignalOpsOperationHandleV1 {
  readonly id: string;
  readonly acceptedEventId: string;
  startAttempt(input: SignalOpsStartAttemptInputV1): SignalOpsAttemptHandleV1;
  finish(input: SignalOpsOperationFinishInputV1): SignalOpsRecordResultV1;
  succeed(options?: SignalOpsOperationFinishOptionsV1): SignalOpsRecordResultV1;
  fail(failure?: unknown, options?: SignalOpsOperationFinishOptionsV1): SignalOpsRecordResultV1;
  cancel(failure?: unknown, options?: SignalOpsOperationFinishOptionsV1): SignalOpsRecordResultV1;
  expire(failure?: unknown, options?: SignalOpsOperationFinishOptionsV1): SignalOpsRecordResultV1;
  abandon(failure?: unknown, options?: SignalOpsOperationFinishOptionsV1): SignalOpsRecordResultV1;
}

export interface SignalOpsProducerV1 {
  startOperation(input: SignalOpsStartOperationInputV1): SignalOpsOperationHandleV1;
  recordProviderProbe(input: SignalOpsProviderProbeInputV1): SignalOpsRecordResultV1;
  flush(): Promise<SignalOpsDeliveryReportV1>;
  close(): Promise<SignalOpsDeliveryReportV1>;
  pending(): number;
}

export type SignalOpsProducerConfigV1 = Readonly<{
  source: string;
  resource: SignalOpsResourceV1;
  transport: SignalOpsProducerTransportV1;
  clock?: () => Date;
  onDiagnostic?: (diagnostic: SignalOpsProducerDiagnosticV1) => void;
}>;

const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/u;
const sourcePattern = /^[^?@#\s]{1,240}$/u;
const traceparentPattern = /^(?!ff-)(?![0-9a-f]{2}-0{32}-)(?![0-9a-f]{2}-[0-9a-f]{32}-0{16}-)[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}(?:-[\u0021-\u007e]+)?$/u;
const currencyPattern = /^[A-Z]{3}$/u;
const moneyPattern = /^(0|[1-9][0-9]*)(\.[0-9]{1,12})?$/u;
const operationKinds = new Set([
  "image_generation",
  "video_generation",
  "text_generation",
  "embedding",
  "transcription",
  "training",
  "other",
]);
const terminalStatuses = new Set<SignalOpsTerminalStatusV1>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "abandoned",
]);
const costSources = new Set(["provider_reported", "catalog_estimate", "billing_reconciled"]);

function assertIdentifier(value: string, label: string): void {
  if (!identifierPattern.test(value)) {
    throw new TypeError(`${label} must be a canonical SignalOps identifier`);
  }
}

function canonicalTimestamp(
  value: SignalOpsTimestampInputV1 | undefined,
  clock: () => Date,
): string {
  const date = value instanceof Date ? value : value === undefined ? clock() : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("SignalOps event time is invalid");
  return date.toISOString();
}

function assertTraceparent(value: string | undefined): void {
  if (value !== undefined && !traceparentPattern.test(value)) {
    throw new TypeError("traceparent must follow the W3C trace context format");
  }
}

function canonicalResource(input: SignalOpsResourceV1): SignalOpsResourceV1 {
  assertIdentifier(input.environment, "resource.environment");
  assertIdentifier(input.service, "resource.service");
  if (input.release !== undefined) assertIdentifier(input.release, "resource.release");
  if (input.region !== undefined) assertIdentifier(input.region, "resource.region");
  return {
    environment: input.environment,
    service: input.service,
    ...(input.release !== undefined ? { release: input.release } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
  };
}

function canonicalOperation(input: SignalOpsOperationV1): SignalOpsOperationV1 {
  assertIdentifier(input.id, "operation.id");
  if (!operationKinds.has(input.kind)) {
    throw new TypeError("operation.kind is not supported by SignalOps V1");
  }
  if (input.logicalModelKey !== undefined) {
    assertIdentifier(input.logicalModelKey, "operation.logicalModelKey");
  }
  return {
    id: input.id,
    kind: input.kind,
    ...(input.logicalModelKey !== undefined ? { logicalModelKey: input.logicalModelKey } : {}),
  };
}

function canonicalAttempt(input: SignalOpsAttemptV1): SignalOpsAttemptV1 {
  assertIdentifier(input.id, "attempt.id");
  if (!Number.isInteger(input.number) || input.number < 1 || input.number > 10_000) {
    throw new TypeError("attempt.number must be an integer between 1 and 10000");
  }
  return { id: input.id, number: input.number };
}

function canonicalRoute(input: SignalOpsRouteV1): SignalOpsRouteV1 {
  assertIdentifier(input.providerKey, "route.providerKey");
  assertIdentifier(input.modelKey, "route.modelKey");
  if (input.providerVendor !== undefined) assertIdentifier(input.providerVendor, "route.providerVendor");
  if (input.providerModelKey !== undefined) assertIdentifier(input.providerModelKey, "route.providerModelKey");
  if (input.region !== undefined) assertIdentifier(input.region, "route.region");
  return {
    providerKey: input.providerKey,
    ...(input.providerVendor !== undefined ? { providerVendor: input.providerVendor } : {}),
    modelKey: input.modelKey,
    ...(input.providerModelKey !== undefined ? { providerModelKey: input.providerModelKey } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
  };
}

function canonicalProbeRoute(input: SignalOpsProbeRouteV1): SignalOpsProbeRouteV1 {
  assertIdentifier(input.providerKey, "route.providerKey");
  if (input.providerVendor !== undefined) assertIdentifier(input.providerVendor, "route.providerVendor");
  if (input.modelKey !== undefined) assertIdentifier(input.modelKey, "route.modelKey");
  if (input.providerModelKey !== undefined) assertIdentifier(input.providerModelKey, "route.providerModelKey");
  if (input.region !== undefined) assertIdentifier(input.region, "route.region");
  return {
    providerKey: input.providerKey,
    ...(input.providerVendor !== undefined ? { providerVendor: input.providerVendor } : {}),
    ...(input.modelKey !== undefined ? { modelKey: input.modelKey } : {}),
    ...(input.providerModelKey !== undefined ? { providerModelKey: input.providerModelKey } : {}),
    ...(input.region !== undefined ? { region: input.region } : {}),
  };
}

function canonicalCost(input: SignalOpsCostV1 | undefined): SignalOpsCostV1 | undefined {
  if (!input) return undefined;
  if (!moneyPattern.test(input.amount) || input.amount.length > 40) {
    throw new TypeError("cost.amount must be a non-negative decimal string");
  }
  if (!currencyPattern.test(input.currency)) {
    throw new TypeError("cost.currency must be an uppercase ISO-4217 code");
  }
  if (!costSources.has(input.source)) {
    throw new TypeError("cost.source is not supported by SignalOps V1");
  }
  return { amount: input.amount, currency: input.currency, source: input.source };
}

function nonNegative(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
  return value;
}

function durationBetween(start: string, end: string): number | undefined {
  const duration = Date.parse(end) - Date.parse(start);
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

function terminalOutcome(input: SignalOpsOutcomeInputV1): SignalOpsTerminalOutcomeV1 {
  if (!terminalStatuses.has(input.status)) {
    throw new TypeError("terminal outcome status is not supported by SignalOps V1");
  }
  if (input.status === "succeeded") return { status: "succeeded" };
  if (input.status === "cancelled" && input.failure === undefined) {
    return { status: "cancelled" };
  }
  const failure = normalizeSignalOpsFailureV1(input.failure);
  return { status: input.status, failure } as SignalOpsTerminalOutcomeV1;
}

function eventId(source: string, type: SignalOpsEventTypeV1, identity: string): string {
  const digest = createHash("sha256")
    .update(source)
    .update("\u0000")
    .update(type)
    .update("\u0000")
    .update(identity)
    .digest("hex")
    .slice(0, 48);
  return `sigv1:${digest}`;
}

export function createSignalOpsProducerV1(
  config: SignalOpsProducerConfigV1,
): SignalOpsProducerV1 {
  if (!sourcePattern.test(config.source)) {
    throw new TypeError("source must be a stable URI without userinfo, query, or fragment");
  }
  try {
    new URL(config.source);
  } catch {
    throw new TypeError("source must be an absolute URI");
  }

  const source = config.source;
  const resource = canonicalResource(config.resource);
  const transport = config.transport;
  const clock = config.clock ?? (() => new Date());
  let closed = false;

  function diagnostic(value: SignalOpsProducerDiagnosticV1): void {
    try {
      config.onDiagnostic?.(value);
    } catch {
      // Diagnostics must never affect customer operations.
    }
  }

  function attributes(
    input: SignalOpsAttributesV1 | undefined,
    context: { operationId?: string; attemptId?: string },
  ): SignalOpsAttributesV1 | undefined {
    const sanitized = sanitizeSignalOpsAttributesV1(input);
    if (sanitized.droppedKeys.length > 0) {
      diagnostic({
        code: "attributes_dropped",
        ...context,
        droppedAttributeCount: sanitized.droppedKeys.length,
      });
    }
    return sanitized.attributes;
  }

  function enqueue(event: SignalOpsEventV1): SignalOpsRecordResultV1 {
    if (closed) return { status: "dropped", eventId: event.id };
    try {
      transport.enqueue([event]);
      return { status: "enqueued", eventId: event.id };
    } catch {
      diagnostic({
        code: "transport_enqueue_failed",
        eventId: event.id,
        eventType: event.type,
      });
      return { status: "dropped", eventId: event.id };
    }
  }

  function baseEvent(
    type: SignalOpsEventTypeV1,
    identity: string,
    subject: string,
    time: string,
    traceparent: string | undefined,
  ) {
    assertTraceparent(traceparent);
    return {
      specversion: "1.0" as const,
      id: eventId(source, type, identity),
      source,
      type,
      subject,
      time,
      datacontenttype: "application/json" as const,
      dataschema: SIGNALOPS_V1_SCHEMA_URL,
      ...(traceparent ? { traceparent } : {}),
    };
  }

  function startOperation(input: SignalOpsStartOperationInputV1): SignalOpsOperationHandleV1 {
    const operation = canonicalOperation(input.operation);
    const acceptedAt = canonicalTimestamp(input.time, clock);
    const acceptedAttributes = attributes(input.attributes, { operationId: operation.id });
    const accepted = {
      ...baseEvent(
        "com.signalops.ai.operation.accepted.v1",
        operation.id,
        `operation/${operation.id}`,
        acceptedAt,
        input.traceparent,
      ),
      type: "com.signalops.ai.operation.accepted.v1" as const,
      data: {
        operation,
        resource,
        ...(acceptedAttributes ? { attributes: acceptedAttributes } : {}),
      },
    } satisfies SignalOpsEventV1;
    enqueue(accepted);

    const attempts = new Map<string, { signature: string; handle: SignalOpsAttemptHandleV1 }>();
    const attemptNumbers = new Map<number, string>();
    let operationTerminal: { status: SignalOpsTerminalStatusV1; eventId: string } | undefined;

    function startAttempt(inputAttempt: SignalOpsStartAttemptInputV1): SignalOpsAttemptHandleV1 {
      const attempt = canonicalAttempt(inputAttempt.attempt);
      const route = canonicalRoute(inputAttempt.route);
      const signature = JSON.stringify({ attempt, route });
      const existing = attempts.get(attempt.id);
      if (existing) {
        if (existing.signature !== signature) {
          diagnostic({
            code: "conflicting_attempt_identity",
            operationId: operation.id,
            attemptId: attempt.id,
          });
          throw new TypeError("attempt.id was reused with different route or number");
        }
        return existing.handle;
      }
      const numberOwner = attemptNumbers.get(attempt.number);
      if (numberOwner && numberOwner !== attempt.id) {
        diagnostic({
          code: "conflicting_attempt_identity",
          operationId: operation.id,
          attemptId: attempt.id,
        });
        throw new TypeError("attempt.number was reused by another attempt");
      }

      const startedAt = canonicalTimestamp(inputAttempt.time, clock);
      const startedAttributes = attributes(inputAttempt.attributes, {
        operationId: operation.id,
        attemptId: attempt.id,
      });
      const started = {
        ...baseEvent(
          "com.signalops.ai.attempt.started.v1",
          attempt.id,
          `operation/${operation.id}`,
          startedAt,
          inputAttempt.traceparent ?? input.traceparent,
        ),
        type: "com.signalops.ai.attempt.started.v1" as const,
        data: {
          operation,
          attempt,
          route,
          resource,
          ...(startedAttributes ? { attributes: startedAttributes } : {}),
        },
      } satisfies SignalOpsEventV1;
      enqueue(started);

      let terminal: { status: SignalOpsTerminalStatusV1; eventId: string } | undefined;
      const handle: SignalOpsAttemptHandleV1 = {
        id: attempt.id,
        number: attempt.number,
        startedEventId: started.id,
        finish(finishInput) {
          if (terminal) {
            if (terminal.status !== finishInput.outcome.status) {
              diagnostic({
                code: "conflicting_terminal_ignored",
                eventId: terminal.eventId,
                operationId: operation.id,
                attemptId: attempt.id,
              });
              return { status: "conflict", eventId: terminal.eventId };
            }
            return { status: "duplicate", eventId: terminal.eventId };
          }

          const terminalAt = canonicalTimestamp(finishInput.time, clock);
          const durationMs = nonNegative(
            finishInput.metrics?.durationMs ?? durationBetween(startedAt, terminalAt),
            "attempt.metrics.durationMs",
          );
          const queueDurationMs = nonNegative(
            finishInput.metrics?.queueDurationMs,
            "attempt.metrics.queueDurationMs",
          );
          const outputUnits = nonNegative(
            finishInput.metrics?.outputUnits,
            "attempt.metrics.outputUnits",
          );
          const metrics = {
            ...(durationMs !== undefined ? { durationMs } : {}),
            ...(queueDurationMs !== undefined ? { queueDurationMs } : {}),
            ...(outputUnits !== undefined ? { outputUnits } : {}),
          };
          const terminalAttributes = attributes(finishInput.attributes, {
            operationId: operation.id,
            attemptId: attempt.id,
          });
          const terminalEvent = {
            ...baseEvent(
              "com.signalops.ai.attempt.terminal.v1",
              attempt.id,
              `operation/${operation.id}`,
              terminalAt,
              finishInput.traceparent ?? inputAttempt.traceparent ?? input.traceparent,
            ),
            type: "com.signalops.ai.attempt.terminal.v1" as const,
            data: {
              operation,
              attempt,
              route,
              outcome: terminalOutcome(finishInput.outcome),
              ...(Object.keys(metrics).length > 0 ? { metrics } : {}),
              ...(finishInput.cost ? { cost: canonicalCost(finishInput.cost) } : {}),
              resource,
              ...(terminalAttributes ? { attributes: terminalAttributes } : {}),
            },
          } satisfies SignalOpsEventV1;
          terminal = { status: finishInput.outcome.status, eventId: terminalEvent.id };
          return enqueue(terminalEvent);
        },
        succeed(options = {}) {
          return this.finish({ ...options, outcome: { status: "succeeded" } });
        },
        fail(failure, options = {}) {
          return this.finish({ ...options, outcome: { status: "failed", failure } });
        },
        cancel(failure, options = {}) {
          return this.finish({ ...options, outcome: { status: "cancelled", failure } });
        },
        expire(failure, options = {}) {
          return this.finish({ ...options, outcome: { status: "expired", failure } });
        },
        abandon(failure, options = {}) {
          return this.finish({ ...options, outcome: { status: "abandoned", failure } });
        },
      };

      attempts.set(attempt.id, { signature, handle });
      attemptNumbers.set(attempt.number, attempt.id);
      return handle;
    }

    function finishOperation(
      finishInput: SignalOpsOperationFinishInputV1,
    ): SignalOpsRecordResultV1 {
      if (operationTerminal) {
        if (operationTerminal.status !== finishInput.outcome.status) {
          diagnostic({
            code: "conflicting_terminal_ignored",
            eventId: operationTerminal.eventId,
            operationId: operation.id,
          });
          return { status: "conflict", eventId: operationTerminal.eventId };
        }
        return { status: "duplicate", eventId: operationTerminal.eventId };
      }

      const terminalAt = canonicalTimestamp(finishInput.time, clock);
      const totalDurationMs = nonNegative(
        finishInput.metrics?.totalDurationMs ?? durationBetween(acceptedAt, terminalAt),
        "operation.metrics.totalDurationMs",
      );
      const attemptCount = finishInput.metrics?.attemptCount ?? attempts.size;
      if (!Number.isInteger(attemptCount) || attemptCount < 0 || attemptCount > 10_000) {
        throw new TypeError("operation.metrics.attemptCount must be an integer from 0 to 10000");
      }
      const terminalAttributes = attributes(finishInput.attributes, {
        operationId: operation.id,
      });
      const terminalEvent = {
        ...baseEvent(
          "com.signalops.ai.operation.terminal.v1",
          operation.id,
          `operation/${operation.id}`,
          terminalAt,
          finishInput.traceparent ?? input.traceparent,
        ),
        type: "com.signalops.ai.operation.terminal.v1" as const,
        data: {
          operation,
          outcome: terminalOutcome(finishInput.outcome),
          metrics: {
            ...(totalDurationMs !== undefined ? { totalDurationMs } : {}),
            attemptCount,
          },
          resource,
          ...(terminalAttributes ? { attributes: terminalAttributes } : {}),
        },
      } satisfies SignalOpsEventV1;
      operationTerminal = {
        status: finishInput.outcome.status,
        eventId: terminalEvent.id,
      };
      return enqueue(terminalEvent);
    }

    return {
      id: operation.id,
      acceptedEventId: accepted.id,
      startAttempt,
      finish: finishOperation,
      succeed(options = {}) {
        return finishOperation({ ...options, outcome: { status: "succeeded" } });
      },
      fail(failure, options = {}) {
        return finishOperation({ ...options, outcome: { status: "failed", failure } });
      },
      cancel(failure, options = {}) {
        return finishOperation({ ...options, outcome: { status: "cancelled", failure } });
      },
      expire(failure, options = {}) {
        return finishOperation({ ...options, outcome: { status: "expired", failure } });
      },
      abandon(failure, options = {}) {
        return finishOperation({ ...options, outcome: { status: "abandoned", failure } });
      },
    };
  }

  function recordProviderProbe(
    input: SignalOpsProviderProbeInputV1,
  ): SignalOpsRecordResultV1 {
    const route = canonicalProbeRoute(input.route);
    const time = canonicalTimestamp(input.time, clock);
    const probeAttributes = attributes(input.attributes, {});
    const probe = {
      ...baseEvent(
        "com.signalops.ai.provider.probe.v1",
        `${route.providerKey}\u0000${route.modelKey ?? ""}\u0000${time}`,
        `provider/${route.providerKey}`,
        time,
        input.traceparent,
      ),
      type: "com.signalops.ai.provider.probe.v1" as const,
      data: {
        route,
        outcome: input.outcome.status === "succeeded"
          ? { status: "succeeded" as const }
          : {
              status: "failed" as const,
              failure: normalizeSignalOpsFailureV1(input.outcome.failure),
            },
        ...(input.metrics?.durationMs !== undefined
          ? {
              metrics: {
                durationMs: nonNegative(input.metrics.durationMs, "probe.metrics.durationMs")!,
              },
            }
          : {}),
        resource,
        ...(probeAttributes ? { attributes: probeAttributes } : {}),
      },
    } satisfies SignalOpsEventV1;
    return enqueue(probe);
  }

  return {
    startOperation,
    recordProviderProbe,
    async flush() {
      try {
        return await transport.flush();
      } catch {
        diagnostic({ code: "transport_flush_failed" });
        return emptySignalOpsDeliveryReportV1(transport.pending());
      }
    },
    async close() {
      closed = true;
      try {
        return await transport.close();
      } catch {
        diagnostic({ code: "transport_close_failed" });
        return emptySignalOpsDeliveryReportV1(transport.pending());
      }
    },
    pending() {
      return transport.pending();
    },
  };
}

import type { SignalOpsEventV1 } from "@signalops/contracts/v1";

import {
  type SignalOpsDeadLetterReasonV1,
  type SignalOpsDeadLetterV1,
  type SignalOpsDeliveryReportV1,
  type SignalOpsProducerTransportV1,
} from "./transport.js";

type FetchLikeV1 = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SignalOpsHttpTransportDiagnosticV1 = Readonly<{
  code: "dead_letter" | "retry_scheduled";
  eventCount: number;
  attempt: number;
  delayMs?: number;
  status?: number;
  reason?: SignalOpsDeadLetterReasonV1;
}>;

export type SignalOpsHttpTransportConfigV1 = Readonly<{
  endpoint: string;
  getCredential: () => string | Promise<string>;
  fetch?: FetchLikeV1;
  batchSize?: number;
  maxBodyBytes?: number;
  maxQueueEvents?: number;
  flushIntervalMs?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  random?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
  onDeadLetter?: (deadLetter: SignalOpsDeadLetterV1) => void | Promise<void>;
  onDiagnostic?: (diagnostic: SignalOpsHttpTransportDiagnosticV1) => void;
}>;

type IngestIssueV1 = {
  instancePath: string;
  keyword: string;
  message: string;
};

type IngestRejectionV1 = {
  index: number;
  issues: IngestIssueV1[];
};

type IngestReceiptV1 = {
  acceptedEvents: number;
  rejectedEvents: number;
  storedEvents: number;
  duplicateEvents: number;
  conflictEvents: number;
  storedEventIds: string[];
  duplicateEventIds: string[];
  conflictEventIds: string[];
  rejected: IngestRejectionV1[];
};

type DeliveryResultV1 = {
  deliveredEvents: number;
  duplicateEvents: number;
  deadLetteredEvents: number;
};

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

function safeCallback(callback: (() => void) | undefined): void {
  try {
    callback?.();
  } catch {
    // Observer failures never affect producer delivery.
  }
}

function asNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = value === undefined || !Number.isFinite(value) ? fallback : value;
  return Math.max(minimum, Math.min(Math.trunc(candidate), maximum));
}

function asIdentifierList(value: unknown, batchIds: Set<string>): value is string[] {
  return (
    Array.isArray(value) &&
    new Set(value).size === value.length &&
    value.every((entry) => typeof entry === "string" && batchIds.has(entry))
  );
}

function isIssue(value: unknown): value is IngestIssueV1 {
  if (!value || typeof value !== "object") return false;
  const issue = value as Record<string, unknown>;
  return (
    typeof issue.instancePath === "string" &&
    typeof issue.keyword === "string" &&
    typeof issue.message === "string"
  );
}

function parseReceipt(body: unknown, batch: readonly SignalOpsEventV1[]): IngestReceiptV1 | null {
  if (!body || typeof body !== "object" || (body as { ok?: unknown }).ok !== true) return null;
  const receipt = (body as { receipt?: unknown }).receipt;
  if (!receipt || typeof receipt !== "object") return null;
  const value = receipt as Record<string, unknown>;
  const batchIds = new Set(batch.map((event) => event.id));
  if (
    !asNonNegativeInteger(value.acceptedEvents) ||
    !asNonNegativeInteger(value.rejectedEvents) ||
    !asNonNegativeInteger(value.storedEvents) ||
    !asNonNegativeInteger(value.duplicateEvents) ||
    !asNonNegativeInteger(value.conflictEvents) ||
    !asIdentifierList(value.storedEventIds, batchIds) ||
    !asIdentifierList(value.duplicateEventIds, batchIds) ||
    !asIdentifierList(value.conflictEventIds, batchIds) ||
    !Array.isArray(value.rejected)
  ) {
    return null;
  }
  const rejected = value.rejected as unknown[];
  if (!rejected.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const rejection = entry as Record<string, unknown>;
    return (
      Number.isInteger(rejection.index) &&
      Number(rejection.index) >= 0 &&
      Number(rejection.index) < batch.length &&
      Array.isArray(rejection.issues) &&
      rejection.issues.length > 0 &&
      rejection.issues.every(isIssue)
    );
  })) {
    return null;
  }

  const result = value as unknown as IngestReceiptV1;
  const rejectedIndexes = new Set(result.rejected.map((entry) => entry.index));
  const classifiedIds = new Set([
    ...result.storedEventIds,
    ...result.duplicateEventIds,
    ...result.conflictEventIds,
  ]);
  const expectedAcceptedIds = new Set(
    batch.filter((_, index) => !rejectedIndexes.has(index)).map((event) => event.id),
  );
  if (
    result.rejectedEvents !== rejectedIndexes.size ||
    result.rejectedEvents !== result.rejected.length ||
    result.storedEvents !== result.storedEventIds.length ||
    result.duplicateEvents !== result.duplicateEventIds.length ||
    result.conflictEvents !== result.conflictEventIds.length ||
    result.acceptedEvents + result.rejectedEvents !== batch.length ||
    result.acceptedEvents !== classifiedIds.size ||
    expectedAcceptedIds.size !== classifiedIds.size ||
    [...expectedAcceptedIds].some((id) => !classifiedIds.has(id)) ||
    result.storedEvents + result.duplicateEvents + result.conflictEvents !== result.acceptedEvents
  ) {
    return null;
  }
  return result;
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function validateEndpoint(value: string): string {
  const endpoint = new URL(value);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError("SignalOps endpoint cannot contain credentials, a query, or a fragment");
  }
  const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) {
    throw new TypeError("SignalOps endpoint must use HTTPS, except on loopback");
  }
  return endpoint.toString();
}

export function createSignalOpsHttpTransportV1(
  config: SignalOpsHttpTransportConfigV1,
): SignalOpsProducerTransportV1 {
  const endpoint = validateEndpoint(config.endpoint);
  const fetcher = config.fetch ?? fetch;
  const batchSize = boundedInteger(config.batchSize, 100, 1, 100);
  const maxBodyBytes = boundedInteger(
    config.maxBodyBytes,
    DEFAULT_MAX_BODY_BYTES,
    1_024,
    DEFAULT_MAX_BODY_BYTES,
  );
  const maxQueueEvents = boundedInteger(
    config.maxQueueEvents,
    10_000,
    batchSize,
    1_000_000,
  );
  const flushIntervalMs = boundedInteger(config.flushIntervalMs, 1_000, 0, 60_000);
  const requestTimeoutMs = boundedInteger(config.requestTimeoutMs, 5_000, 100, 120_000);
  const maxAttempts = boundedInteger(config.maxAttempts, 5, 1, 20);
  const baseRetryDelayMs = boundedInteger(config.baseRetryDelayMs, 250, 0, 60_000);
  const maxRetryDelayMs = boundedInteger(
    config.maxRetryDelayMs,
    10_000,
    baseRetryDelayMs,
    300_000,
  );
  const random = config.random ?? Math.random;
  const sleep = config.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  const queue: SignalOpsEventV1[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flushPromise: Promise<SignalOpsDeliveryReportV1> | undefined;
  let closed = false;
  let carriedDeadLetters = 0;
  const deferredDeadLetters = new Set<Promise<void>>();

  function diagnostic(value: SignalOpsHttpTransportDiagnosticV1): void {
    safeCallback(() => config.onDiagnostic?.(value));
  }

  async function deadLetter(
    events: readonly SignalOpsEventV1[],
    reason: SignalOpsDeadLetterReasonV1,
    attempts: number,
    status?: number,
  ): Promise<void> {
    diagnostic({
      code: "dead_letter",
      eventCount: events.length,
      attempt: attempts,
      reason,
      ...(status !== undefined ? { status } : {}),
    });
    try {
      await config.onDeadLetter?.({
        events: structuredClone(events),
        reason,
        attempts,
        ...(status !== undefined ? { status } : {}),
      });
    } catch {
      // A failed observer cannot fail or requeue a customer operation.
    }
  }

  function deferDeadLetter(
    events: readonly SignalOpsEventV1[],
    reason: SignalOpsDeadLetterReasonV1,
    attempts: number,
    status?: number,
  ): void {
    const task = deadLetter(events, reason, attempts, status);
    deferredDeadLetters.add(task);
    void task.finally(() => deferredDeadLetters.delete(task));
  }

  function scheduleFlush(): void {
    if (closed || flushIntervalMs === 0 || timer || flushPromise || queue.length === 0) return;
    timer = setTimeout(() => {
      timer = undefined;
      void flush().catch(() => undefined);
    }, flushIntervalMs);
    timer.unref?.();
  }

  function bodyFor(events: readonly SignalOpsEventV1[]): string {
    return JSON.stringify({ events });
  }

  function takeBatch(): { events: SignalOpsEventV1[]; body: string } | null {
    let count = Math.min(batchSize, queue.length);
    while (count > 0) {
      const events = queue.slice(0, count);
      const body = bodyFor(events);
      if (new TextEncoder().encode(body).byteLength <= maxBodyBytes) {
        queue.splice(0, count);
        return { events, body };
      }
      count = count === 1 ? 0 : Math.max(1, Math.floor(count / 2));
    }
    return null;
  }

  async function requestBatch(
    batch: { events: SignalOpsEventV1[]; body: string },
  ): Promise<DeliveryResultV1> {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response | undefined;
      let retryAfter: number | undefined;
      try {
        const credential = await config.getCredential();
        if (!credential || /\s/u.test(credential)) {
          await deadLetter(batch.events, "authentication_failed", attempt);
          return { deliveredEvents: 0, duplicateEvents: 0, deadLetteredEvents: batch.events.length };
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
        timeout.unref?.();
        try {
          response = await fetcher(endpoint, {
            method: "POST",
            headers: {
              accept: "application/json",
              authorization: `Bearer ${credential}`,
              "content-type": "application/json",
              "user-agent": "@signalops/producer-node/0.1.0",
            },
            body: batch.body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (response.ok) {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            body = undefined;
          }
          const receipt = parseReceipt(body, batch.events);
          if (receipt) {
            const conflicts = new Set(receipt.conflictEventIds);
            const rejectedIndexes = new Set(receipt.rejected.map((entry) => entry.index));
            const rejectedEvents = batch.events.filter((_, index) => rejectedIndexes.has(index));
            const conflictEvents = batch.events.filter((event) => conflicts.has(event.id));
            if (rejectedEvents.length > 0) {
              await deadLetter(rejectedEvents, "ingest_rejected", attempt, response.status);
            }
            if (conflictEvents.length > 0) {
              await deadLetter(conflictEvents, "ingest_conflict", attempt, response.status);
            }
            return {
              deliveredEvents: receipt.storedEvents + receipt.duplicateEvents,
              duplicateEvents: receipt.duplicateEvents,
              deadLetteredEvents: rejectedEvents.length + conflictEvents.length,
            };
          }
          if (attempt === maxAttempts) {
            await deadLetter(batch.events, "invalid_response", attempt, response.status);
            return { deliveredEvents: 0, duplicateEvents: 0, deadLetteredEvents: batch.events.length };
          }
        } else if (!retryableStatus(response.status)) {
          const reason: SignalOpsDeadLetterReasonV1 = response.status === 401 || response.status === 403
            ? "authentication_failed"
            : "non_retryable_response";
          await deadLetter(batch.events, reason, attempt, response.status);
          return { deliveredEvents: 0, duplicateEvents: 0, deadLetteredEvents: batch.events.length };
        } else {
          retryAfter = retryAfterMs(response);
          if (attempt === maxAttempts) {
            await deadLetter(batch.events, "retry_exhausted", attempt, response.status);
            return { deliveredEvents: 0, duplicateEvents: 0, deadLetteredEvents: batch.events.length };
          }
        }
      } catch {
        if (attempt === maxAttempts) {
          await deadLetter(batch.events, "retry_exhausted", attempt, response?.status);
          return { deliveredEvents: 0, duplicateEvents: 0, deadLetteredEvents: batch.events.length };
        }
      }

      const exponential = Math.min(maxRetryDelayMs, baseRetryDelayMs * 2 ** (attempt - 1));
      let randomSample = 0.5;
      try {
        randomSample = random();
      } catch {
        // A custom entropy source is observability plumbing, not application control flow.
      }
      const unitRandom = Number.isFinite(randomSample)
        ? Math.max(0, Math.min(1, randomSample))
        : 0.5;
      const jittered = Math.round(exponential * (0.5 + unitRandom));
      const delayMs = Math.min(maxRetryDelayMs, Math.max(retryAfter ?? 0, jittered));
      diagnostic({
        code: "retry_scheduled",
        eventCount: batch.events.length,
        attempt,
        delayMs,
        ...(response ? { status: response.status } : {}),
      });
      try {
        await sleep(delayMs);
      } catch {
        // An injected scheduler cannot turn telemetry into a customer-operation failure.
      }
    }

    return { deliveredEvents: 0, duplicateEvents: 0, deadLetteredEvents: 0 };
  }

  async function drain(): Promise<SignalOpsDeliveryReportV1> {
    const report = {
      deliveredEvents: 0,
      duplicateEvents: 0,
      deadLetteredEvents: carriedDeadLetters,
      pendingEvents: 0,
    };
    carriedDeadLetters = 0;

    while (queue.length > 0) {
      const batch = takeBatch();
      if (!batch) {
        const oversized = queue.shift();
        if (oversized) {
          await deadLetter([oversized], "event_too_large", 0);
          report.deadLetteredEvents += 1;
        }
        continue;
      }
      const result = await requestBatch(batch);
      report.deliveredEvents += result.deliveredEvents;
      report.duplicateEvents += result.duplicateEvents;
      report.deadLetteredEvents += result.deadLetteredEvents;
    }
    if (deferredDeadLetters.size > 0) {
      await Promise.all([...deferredDeadLetters]);
    }
    report.pendingEvents = queue.length;
    return report;
  }

  function flush(): Promise<SignalOpsDeliveryReportV1> {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (flushPromise) return flushPromise;
    flushPromise = drain().finally(() => {
      flushPromise = undefined;
      scheduleFlush();
    });
    return flushPromise;
  }

  return {
    enqueue(events) {
      const cloned = events.map((event) => structuredClone(event));
      if (closed) {
        carriedDeadLetters += cloned.length;
        deferDeadLetter(cloned, "closed", 0);
        return;
      }
      const overflow = Math.max(0, queue.length + cloned.length - maxQueueEvents);
      if (overflow > 0) {
        const evicted = queue.splice(0, overflow);
        carriedDeadLetters += evicted.length;
        if (evicted.length > 0) deferDeadLetter(evicted, "queue_overflow", 0);
      }
      const room = maxQueueEvents - queue.length;
      const accepted = cloned.slice(0, room);
      const rejected = cloned.slice(room);
      queue.push(...accepted);
      if (rejected.length > 0) {
        carriedDeadLetters += rejected.length;
        deferDeadLetter(rejected, "queue_overflow", 0);
      }
      scheduleFlush();
    },
    flush,
    async close() {
      closed = true;
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      return flush();
    },
    pending() {
      return queue.length;
    },
  };
}

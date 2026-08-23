import assert from "node:assert/strict";

import {
  createSignalOpsHttpTransportV1,
  createSignalOpsMemoryTransportV1,
  createSignalOpsProducerV1,
  runSignalOpsProducerConformanceV1,
  sanitizeSignalOpsAttributesV1,
} from "../packages/producer-node/dist/index.js";
import { validateSignalOpsEventV1 } from "../src/lib/signalops/v1/contract.ts";

function createReceipt(events, overrides = {}) {
  const storedEventIds = overrides.storedEventIds ?? events.map((event) => event.id);
  const duplicateEventIds = overrides.duplicateEventIds ?? [];
  const conflictEventIds = overrides.conflictEventIds ?? [];
  const rejected = overrides.rejected ?? [];
  return {
    ok: true,
    requestId: "req_11111111-1111-4111-8111-111111111111",
    receipt: {
      acceptedEvents: storedEventIds.length + duplicateEventIds.length + conflictEventIds.length,
      rejectedEvents: rejected.length,
      storedEvents: storedEventIds.length,
      duplicateEvents: duplicateEventIds.length,
      conflictEvents: conflictEventIds.length,
      storedEventIds,
      duplicateEventIds,
      conflictEventIds,
      rejected,
    },
  };
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

async function captureConformanceScenario(scenario) {
  const memory = createSignalOpsMemoryTransportV1();
  const producer = createSignalOpsProducerV1({
    source: scenario.source,
    resource: scenario.resource,
    transport: memory,
    clock: () => new Date("2026-08-23T12:00:00.000Z"),
  });
  const operation = producer.startOperation({
    operation: scenario.operation,
    time: scenario.acceptedAt,
    traceparent: scenario.traceparent,
    attributes: {
      workflow: "conformance",
      promptText: scenario.privateCanary,
      debugUrl: "https://private.example.test/media.png",
    },
  });
  const attempt = operation.startAttempt({
    attempt: scenario.attempt,
    route: scenario.route,
    time: scenario.attemptStartedAt,
    traceparent: scenario.traceparent,
  });

  if (scenario.name === "success") {
    attempt.succeed({
      time: scenario.attemptTerminalAt,
      metrics: { outputUnits: 1 },
      cost: { amount: "0.0123", currency: "USD", source: "provider_reported" },
    });
    operation.succeed({ time: scenario.operationTerminalAt });
  } else {
    const failure = {
      category: "provider_timeout",
      responsibility: "provider",
      code: "upstream_timeout",
      retryable: true,
      rawError: scenario.secretCanary,
      message: scenario.privateCanary,
    };
    attempt.fail(failure, { time: scenario.attemptTerminalAt });
    operation.fail(failure, { time: scenario.operationTerminalAt });
  }
  await producer.flush();
  return memory.events();
}

const conformance = await runSignalOpsProducerConformanceV1({
  capture: captureConformanceScenario,
  validate: validateSignalOpsEventV1,
});
assert.equal(conformance.ok, true, JSON.stringify(conformance.issues, null, 2));
assert.equal(conformance.scenarios, 2);
assert.equal(conformance.events, 8);

const sanitized = sanitizeSignalOpsAttributesV1({
  workflow: "generation",
  prompt: "secret",
  email: "operator@example.test",
  endpoint: "https://private.example.test",
  attempts: 2,
  enabled: true,
});
assert.deepEqual(sanitized.attributes, { attempts: 2, enabled: true, workflow: "generation" });
assert.deepEqual(sanitized.droppedKeys, ["email", "endpoint", "prompt"]);

const idempotentMemory = createSignalOpsMemoryTransportV1();
const idempotentDiagnostics = [];
const idempotentProducer = createSignalOpsProducerV1({
  source: "https://idempotent.example.test/worker",
  resource: { environment: "test", service: "worker" },
  transport: idempotentMemory,
  clock: () => new Date("2026-08-23T13:00:00.000Z"),
  onDiagnostic: (diagnostic) => idempotentDiagnostics.push(diagnostic),
});
const idempotentOperation = idempotentProducer.startOperation({
  operation: { id: "operation-idempotent", kind: "text_generation" },
});
const firstTerminal = idempotentOperation.succeed();
const duplicateTerminal = idempotentOperation.succeed();
const conflictingTerminal = idempotentOperation.fail();
assert.equal(firstTerminal.status, "enqueued");
assert.deepEqual(duplicateTerminal, { status: "duplicate", eventId: firstTerminal.eventId });
assert.deepEqual(conflictingTerminal, { status: "conflict", eventId: firstTerminal.eventId });
await idempotentProducer.flush();
assert.equal(idempotentMemory.events().length, 2);
assert.ok(idempotentDiagnostics.some((entry) => entry.code === "conflicting_terminal_ignored"));

const sourceEvents = await captureConformanceScenario({
  name: "success",
  source: "https://http.example.test/worker",
  resource: { environment: "test", service: "worker", release: "v1" },
  operation: { id: "http-operation", kind: "image_generation", logicalModelKey: "image-balanced" },
  attempt: { id: "http-attempt", number: 1 },
  route: {
    providerKey: "primary",
    providerVendor: "openai",
    modelKey: "image-balanced",
    providerModelKey: "gpt-image-2",
    region: "global",
  },
  acceptedAt: "2026-08-23T13:00:00.000Z",
  attemptStartedAt: "2026-08-23T13:00:01.000Z",
  attemptTerminalAt: "2026-08-23T13:00:03.000Z",
  operationTerminalAt: "2026-08-23T13:00:04.000Z",
  traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
  privateCanary: "private@example.test",
  secretCanary: "Bearer secret",
});

const retryRequests = [];
const retryDelays = [];
const retryDiagnostics = [];
let retryCall = 0;
const retryTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async (_url, init) => {
    const events = JSON.parse(init.body).events;
    retryRequests.push({ events, authorization: new Headers(init.headers).get("authorization") });
    retryCall += 1;
    if (retryCall === 1) return jsonResponse({ ok: false }, 503, { "retry-after": "0" });
    if (retryCall === 2) return jsonResponse({ ok: false }, 429, { "retry-after": "0" });
    return jsonResponse(createReceipt(events));
  },
  flushIntervalMs: 0,
  baseRetryDelayMs: 10,
  maxRetryDelayMs: 100,
  random: () => 0.5,
  sleep: async (delay) => { retryDelays.push(delay); },
  onDiagnostic: (diagnostic) => retryDiagnostics.push(diagnostic),
});
retryTransport.enqueue(sourceEvents);
const retryReport = await retryTransport.flush();
assert.deepEqual(retryReport, {
  deliveredEvents: 4,
  duplicateEvents: 0,
  deadLetteredEvents: 0,
  pendingEvents: 0,
});
assert.deepEqual(retryDelays, [10, 20]);
assert.equal(retryRequests.length, 3);
assert.ok(retryRequests.every((request) => request.authorization === "Bearer credential-test-only"));
assert.ok(retryDiagnostics.every((entry) => entry.code === "retry_scheduled"));

const reconciliationDeadLetters = [];
const reconciliationTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async (_url, init) => {
    const events = JSON.parse(init.body).events;
    return jsonResponse(createReceipt(events, {
      storedEventIds: [events[0].id, events[1].id],
      conflictEventIds: [events[2].id],
      rejected: [{
        index: 3,
        issues: [{ instancePath: "/data", keyword: "privacy", message: "rejected fixture" }],
      }],
    }));
  },
  flushIntervalMs: 0,
  onDeadLetter: (entry) => { reconciliationDeadLetters.push(entry); },
});
reconciliationTransport.enqueue(sourceEvents);
const reconciliationReport = await reconciliationTransport.flush();
assert.deepEqual(reconciliationReport, {
  deliveredEvents: 2,
  duplicateEvents: 0,
  deadLetteredEvents: 2,
  pendingEvents: 0,
});
assert.deepEqual(
  reconciliationDeadLetters.map((entry) => entry.reason).sort(),
  ["ingest_conflict", "ingest_rejected"],
);

const authDeadLetters = [];
const authTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async () => jsonResponse({ ok: false }, 401),
  flushIntervalMs: 0,
  onDeadLetter: (entry) => { authDeadLetters.push(entry); },
});
authTransport.enqueue(sourceEvents);
const authReport = await authTransport.flush();
assert.equal(authReport.deadLetteredEvents, 4);
assert.equal(authDeadLetters[0].reason, "authentication_failed");
assert.equal(authDeadLetters[0].status, 401);

const batchSizes = [];
const batchedTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async (_url, init) => {
    const events = JSON.parse(init.body).events;
    batchSizes.push(events.length);
    return jsonResponse(createReceipt(events));
  },
  flushIntervalMs: 0,
  batchSize: 100,
  maxQueueEvents: 1_000,
});
const manyEvents = Array.from({ length: 205 }, (_, index) => ({
  ...structuredClone(sourceEvents[index % sourceEvents.length]),
  id: `batched-event-${String(index).padStart(3, "0")}`,
}));
batchedTransport.enqueue(manyEvents);
const batchedReport = await batchedTransport.flush();
assert.deepEqual(batchSizes, [100, 100, 5]);
assert.equal(batchedReport.deliveredEvents, 205);

const retryDeadLetters = [];
const failingTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async () => { throw new Error("network unavailable"); },
  flushIntervalMs: 0,
  maxAttempts: 2,
  baseRetryDelayMs: 0,
  sleep: async () => undefined,
  onDeadLetter: (entry) => { retryDeadLetters.push(entry); },
});
const nonThrowingProducer = createSignalOpsProducerV1({
  source: "https://failure.example.test/worker",
  resource: { environment: "test", service: "worker" },
  transport: failingTransport,
});
nonThrowingProducer.startOperation({
  operation: { id: "delivery-failure-operation", kind: "other" },
});
const failureReport = await nonThrowingProducer.flush();
assert.equal(failureReport.deadLetteredEvents, 1);
assert.equal(retryDeadLetters[0].reason, "retry_exhausted");
assert.equal(retryDeadLetters[0].attempts, 2);

const overflowDeadLetters = [];
const overflowTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async (_url, init) => {
    const events = JSON.parse(init.body).events;
    return jsonResponse(createReceipt(events));
  },
  flushIntervalMs: 0,
  batchSize: 1,
  maxQueueEvents: 2,
  onDeadLetter: async (entry) => {
    await Promise.resolve();
    overflowDeadLetters.push(entry);
  },
});
overflowTransport.enqueue(sourceEvents);
const overflowReport = await overflowTransport.flush();
assert.deepEqual(overflowReport, {
  deliveredEvents: 2,
  duplicateEvents: 0,
  deadLetteredEvents: 2,
  pendingEvents: 0,
});
assert.equal(overflowDeadLetters.length, 1);
assert.equal(overflowDeadLetters[0].reason, "queue_overflow");
assert.equal(overflowDeadLetters[0].events.length, 2);

const oversizedDeadLetters = [];
let oversizedFetches = 0;
const oversizedTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async () => {
    oversizedFetches += 1;
    throw new Error("oversized events must not be sent");
  },
  flushIntervalMs: 0,
  maxBodyBytes: 1_024,
  onDeadLetter: (entry) => { oversizedDeadLetters.push(entry); },
});
const oversizedEvent = structuredClone(sourceEvents[0]);
oversizedEvent.id = "oversized-event";
oversizedEvent.data.attributes = Object.fromEntries(
  Array.from({ length: 20 }, (_, index) => [`safe${index}`, "x".repeat(240)]),
);
oversizedTransport.enqueue([oversizedEvent]);
const oversizedReport = await oversizedTransport.flush();
assert.equal(oversizedFetches, 0);
assert.equal(oversizedReport.deadLetteredEvents, 1);
assert.equal(oversizedDeadLetters[0].reason, "event_too_large");

const malformedDeadLetters = [];
const malformedTransport = createSignalOpsHttpTransportV1({
  endpoint: "https://signalops.example.test/v1/events",
  getCredential: () => "credential-test-only",
  fetch: async () => jsonResponse({ ok: true, receipt: { storedEvents: 1 } }),
  flushIntervalMs: 0,
  maxAttempts: 1,
  onDeadLetter: (entry) => { malformedDeadLetters.push(entry); },
});
malformedTransport.enqueue([sourceEvents[0]]);
const malformedReport = await malformedTransport.flush();
assert.equal(malformedReport.deadLetteredEvents, 1);
assert.equal(malformedDeadLetters[0].reason, "invalid_response");

console.log("signalops universal producer and conformance checks passed");

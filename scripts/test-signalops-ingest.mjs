import assert from "node:assert/strict";

import { SIGNALOPS_EVENT_LIMITS } from "../src/lib/signalops/events.ts";
import {
  authenticateSignalEventIngest,
  isSignalEventIngestConfigured,
} from "../src/lib/signalops/ingest-auth.ts";
import {
  createMemorySignalEventSink,
  getSignalEventSinkForRuntime,
} from "../src/lib/signalops/ingest-sink.ts";
import { handleSignalEventIngest } from "../src/lib/signalops/ingest.ts";

const configuredEnv = { SIGNALOPS_INGEST_TOKEN: "test-token-with-enough-entropy" };

assert.equal(isSignalEventIngestConfigured(configuredEnv), true);
assert.equal(isSignalEventIngestConfigured({}), false);

const unauthorizedCases = [
  new Headers(),
  new Headers({ authorization: "Basic dGVzdDp0ZXN0" }),
  new Headers({ authorization: "Bearer" }),
  new Headers({ authorization: "Bearer wrong-token" }),
  new Headers({ authorization: "Bearer  test-token-with-enough-entropy" }),
];

for (const headers of unauthorizedCases) {
  assert.equal(authenticateSignalEventIngest(headers, configuredEnv), false);
}

assert.equal(
  authenticateSignalEventIngest(
    new Headers({ authorization: "Bearer test-token-with-enough-entropy" }),
    configuredEnv,
  ),
  true,
);

const sink = createMemorySignalEventSink({ capacity: 2 });
const eventOne = { eventId: "evt_one", occurredAt: "2026-07-19T00:00:00.000Z" };
const eventTwo = { eventId: "evt_two", occurredAt: "2026-07-19T00:01:00.000Z" };
const eventThree = { eventId: "evt_three", occurredAt: "2026-07-19T00:02:00.000Z" };

const firstWrite = await sink.store([eventOne, eventTwo]);
assert.deepEqual(firstWrite.storedEventIds, ["evt_one", "evt_two"]);
assert.equal(firstWrite.duplicateEvents, 0);
assert.equal(firstWrite.evictedEvents, 0);
assert.equal(firstWrite.retainedEvents, 2);

const boundedWrite = await sink.store([eventTwo, eventThree]);
assert.deepEqual(boundedWrite.duplicateEventIds, ["evt_two"]);
assert.deepEqual(boundedWrite.storedEventIds, ["evt_three"]);
assert.equal(boundedWrite.evictedEvents, 1);
assert.deepEqual(
  sink.snapshot().map((event) => event.eventId),
  ["evt_two", "evt_three"],
);

sink.reset();
assert.deepEqual(sink.snapshot(), []);

assert.equal(getSignalEventSinkForRuntime({ NODE_ENV: "production" }).adapter, "unconfigured");
assert.equal(getSignalEventSinkForRuntime({ VERCEL: "1" }).adapter, "unconfigured");

const repeatedBatchSink = createMemorySignalEventSink();
const repeatedBatchWrite = await repeatedBatchSink.store([eventOne, eventOne]);
assert.equal(repeatedBatchWrite.storedEvents, 1);
assert.equal(repeatedBatchWrite.duplicateEvents, 1);
assert.equal(repeatedBatchWrite.retainedEvents, 1);

function ingestRequest(body, authorization) {
  return new Request("http://localhost/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body,
  });
}

const fixedRequestId = () => "req_test_ingest";
const validBody = JSON.stringify({
  type: "generation.completed",
  occurredAt: "2026-07-19T00:00:00.000Z",
  generationId: "gen_ingest_001",
  providerId: "fal",
  modelId: "flux-kontext-pro",
  user: "private@example.com",
  prompt: "private prompt",
});

const missingConfigResponse = await handleSignalEventIngest(ingestRequest(validBody), {
  env: {},
  sink: createMemorySignalEventSink(),
  requestIdFactory: fixedRequestId,
});
assert.equal(missingConfigResponse.status, 503);
assert.equal(missingConfigResponse.body.code, "ingest_not_configured");

const unauthorizedResponses = await Promise.all(
  [undefined, "Basic bad", "Bearer", "Bearer wrong-token"].map((authorization) =>
    handleSignalEventIngest(ingestRequest(validBody, authorization), {
      env: configuredEnv,
      sink: createMemorySignalEventSink(),
      requestIdFactory: fixedRequestId,
    }),
  ),
);
for (const response of unauthorizedResponses) {
  assert.equal(response.status, 401);
  assert.deepEqual(response.body, {
    ok: false,
    code: "unauthorized",
    error: "Unauthorized.",
    requestId: "req_test_ingest",
  });
}

const productionSink = createMemorySignalEventSink();
const productionResponse = await handleSignalEventIngest(
  ingestRequest(validBody, "Bearer test-token-with-enough-entropy"),
  {
    env: { ...configuredEnv, NODE_ENV: "production" },
    sink: productionSink,
    requestIdFactory: fixedRequestId,
  },
);
assert.equal(productionResponse.status, 503);
assert.equal(productionResponse.body.code, "storage_not_ready");
assert.deepEqual(productionSink.snapshot(), []);

const ingestSink = createMemorySignalEventSink({ capacity: 4 });
const ingestOptions = {
  env: configuredEnv,
  sink: ingestSink,
  requestIdFactory: fixedRequestId,
  currentTimeMs: Date.parse("2026-07-19T00:05:00.000Z"),
};
const authorizedResponse = await handleSignalEventIngest(
  ingestRequest(validBody, "Bearer test-token-with-enough-entropy"),
  ingestOptions,
);
assert.equal(authorizedResponse.status, 200);
assert.equal(authorizedResponse.body.ok, true);
assert.equal(authorizedResponse.body.partial, false);
assert.equal(authorizedResponse.body.receipt.acceptedEvents, 1);
assert.equal(authorizedResponse.body.receipt.rejectedEvents, 0);
assert.equal(authorizedResponse.body.receipt.storedEvents, 1);
assert.equal(authorizedResponse.body.receipt.duplicateEvents, 0);
assert.match(authorizedResponse.body.receipt.receiptId, /^rcpt_[0-9a-f]{16}$/);
assert.match(authorizedResponse.body.receipt.eventRefs[0], /^evtref_[0-9a-f]{16}$/);
assert.equal(ingestSink.snapshot()[0].user, "[redacted]");
assert.equal(ingestSink.snapshot()[0].prompt, "[redacted]");

const duplicateResponse = await handleSignalEventIngest(
  ingestRequest(validBody, "Bearer test-token-with-enough-entropy"),
  ingestOptions,
);
assert.equal(duplicateResponse.status, 200);
assert.equal(duplicateResponse.body.receipt.storedEvents, 0);
assert.equal(duplicateResponse.body.receipt.duplicateEvents, 1);
assert.equal(
  duplicateResponse.body.receipt.receiptId,
  authorizedResponse.body.receipt.receiptId,
);
assert.equal(ingestSink.snapshot().length, 1);

const conflictingResponse = await handleSignalEventIngest(
  ingestRequest(
    JSON.stringify({ ...JSON.parse(validBody), cost: 99 }),
    "Bearer test-token-with-enough-entropy",
  ),
  ingestOptions,
);
assert.equal(conflictingResponse.status, 409);
assert.equal(conflictingResponse.body.code, "idempotency_conflict");
assert.equal(ingestSink.snapshot().length, 1);
assert.equal(ingestSink.snapshot()[0].cost, undefined);

const atomicConflictSink = createMemorySignalEventSink();
await atomicConflictSink.store([{ eventId: "evt_existing", cost: 1 }]);
const atomicConflict = await atomicConflictSink.store([
  { eventId: "evt_new", cost: 2 },
  { eventId: "evt_existing", cost: 3 },
]);
assert.equal(atomicConflict.conflictEvents, 1);
assert.equal(atomicConflict.storedEvents, 0);
assert.deepEqual(
  atomicConflictSink.snapshot().map((event) => event.eventId),
  ["evt_existing"],
);

const partialSink = createMemorySignalEventSink();
const partialResponse = await handleSignalEventIngest(
  ingestRequest(
    JSON.stringify({
      events: [
        JSON.parse(validBody),
        { ...JSON.parse(validBody), eventId: "invalid-row", durationMs: -1 },
      ],
    }),
    "Bearer test-token-with-enough-entropy",
  ),
  { ...ingestOptions, sink: partialSink },
);
assert.equal(partialResponse.status, 200);
assert.equal(partialResponse.body.partial, true);
assert.equal(partialResponse.body.receipt.acceptedEvents, 1);
assert.equal(partialResponse.body.receipt.rejectedEvents, 1);
assert.equal(partialResponse.body.receipt.storedEvents, 1);
assert.equal(partialSink.snapshot().length, 1);

const invalidJsonResponse = await handleSignalEventIngest(
  ingestRequest("{not-json", "Bearer test-token-with-enough-entropy"),
  { ...ingestOptions, sink: createMemorySignalEventSink() },
);
assert.equal(invalidJsonResponse.status, 400);
assert.equal(invalidJsonResponse.body.code, "invalid_json");

const oversizedSink = createMemorySignalEventSink();
const oversizedResponse = await handleSignalEventIngest(
  new Request("http://localhost/api/events", {
    method: "POST",
    headers: {
      authorization: "Bearer test-token-with-enough-entropy",
      "content-type": "application/json",
      "content-length": String(SIGNALOPS_EVENT_LIMITS.maxBodyBytes + 1),
    },
    body: "{}",
  }),
  { ...ingestOptions, sink: oversizedSink },
);
assert.equal(oversizedResponse.status, 413);
assert.equal(oversizedResponse.body.code, "payload_too_large");
assert.deepEqual(oversizedSink.snapshot(), []);

const rejectedSink = createMemorySignalEventSink();
const rejectedResponse = await handleSignalEventIngest(
  ingestRequest(
    JSON.stringify({ ...JSON.parse(validBody), durationMs: -1 }),
    "Bearer test-token-with-enough-entropy",
  ),
  { ...ingestOptions, sink: rejectedSink },
);
assert.equal(rejectedResponse.status, 422);
assert.equal(rejectedResponse.body.code, "invalid_event");
assert.deepEqual(rejectedSink.snapshot(), []);

const throwingSink = {
  adapter: "memory",
  durable: false,
  capacity: 1,
  async store() {
    throw new Error("secret backend detail");
  },
};
const unexpectedResponse = await handleSignalEventIngest(
  ingestRequest(validBody, "Bearer test-token-with-enough-entropy"),
  { ...ingestOptions, sink: throwingSink },
);
assert.equal(unexpectedResponse.status, 500);
assert.equal(unexpectedResponse.body.code, "internal_error");
assert.doesNotMatch(JSON.stringify(unexpectedResponse.body), /secret backend detail/);

console.log("signalops protected ingest auth, storage, and receipt checks passed");

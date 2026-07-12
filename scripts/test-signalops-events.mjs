import assert from "node:assert/strict";

import {
  SIGNALOPS_EVENT_LIMITS,
  getUtf8ByteLength,
  normalizeSignalEvent,
  normalizeSignalEventBatch,
  summarizeSignalEventValidation,
  validateSignalEventRequest,
} from "../src/lib/signalops/events.ts";

const NOW = Date.parse("2026-07-12T12:30:00.000Z");
const requestNow = Date.now();

function isoOffset(offsetMs) {
  return new Date(requestNow + offsetMs).toISOString();
}

function jsonRequest(body, headers = {}) {
  return new Request("http://localhost/api/events/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body,
  });
}

const deterministicInput = {
  type: "generation.completed",
  occurredAt: "2026-07-12T12:00:00.000Z",
  generationId: "gen_contract_001",
  providerId: "fal",
  modelId: "flux-kontext-pro",
  source: "public-api",
  status: "succeeded",
  durationMs: 18340,
  cost: 0.057,
  user: "ops@signalops.cc",
  prompt: "sensitive prompt",
};

const derivedEvent = normalizeSignalEvent(deterministicInput, {
  currentTimeMs: NOW,
  receivedAt: "2026-07-12T12:30:00.000Z",
});
const derivedEventAgain = normalizeSignalEvent(deterministicInput, {
  currentTimeMs: NOW,
  receivedAt: "2026-07-12T12:30:00.000Z",
});

assert.equal(derivedEvent.generationId, "gen_contract_001");
assert.equal(derivedEventAgain.generationId, "gen_contract_001");
assert.equal(derivedEvent.eventId, derivedEventAgain.eventId);
assert.match(derivedEvent.eventId, /^generation\.completed:gen_contract_001:[0-9a-f]{8}$/);
assert.equal(derivedEvent.user, "[redacted]");
assert.equal(derivedEvent.prompt, "[redacted]");

const firstRetry = normalizeSignalEvent(
  { ...deterministicInput, type: "generation.retrying", retryCount: 1 },
  { currentTimeMs: NOW },
);
const secondRetry = normalizeSignalEvent(
  {
    ...deterministicInput,
    type: "generation.retrying",
    occurredAt: "2026-07-12T12:01:00.000Z",
    retryCount: 2,
  },
  { currentTimeMs: NOW },
);
assert.notEqual(firstRetry.eventId, secondRetry.eventId);

const partialBatch = normalizeSignalEventBatch(
  {
    events: [
      {
        type: "generation.completed",
        occurredAt: "2026-07-12T12:00:00.000Z",
        generationId: "gen_partial_001",
        providerId: "fal",
        modelId: "flux-kontext-pro",
        source: "public-api",
        durationMs: 1,
        cost: 0,
      },
      {
        type: "generation.retrying",
        occurredAt: "3026-07-12T12:00:00.000Z",
        generationId: "gen_partial_001",
        providerId: "fal",
        modelId: "flux-kontext-pro",
        retryCount: 1.2,
      },
    ],
  },
  { currentTimeMs: NOW, receivedAt: "2026-07-12T12:30:00.000Z" },
);

assert.equal(partialBatch.events.length, 1);
assert.equal(partialBatch.rejected.length, 1);
assert.match(partialBatch.rejected[0].error, /future|integer/);

const summary = summarizeSignalEventValidation(partialBatch, "redact");
assert.equal(summary.validEvents, 1);
assert.equal(summary.rejectedEvents, 1);
assert.equal(summary.storedEvents, 0);

assert.throws(
  () =>
    normalizeSignalEvent(
      { ...deterministicInput, occurredAt: "July 12, 2026 12:00:00 UTC" },
      { currentTimeMs: NOW },
    ),
  /UTC ISO-8601 format/,
);

const retryOnlySummary = summarizeSignalEventValidation(
  normalizeSignalEventBatch(
    {
      ...deterministicInput,
      type: "generation.retrying",
      retryCount: 1,
    },
    { currentTimeMs: NOW },
  ),
);
assert.ok(retryOnlySummary.diagnostics.gaps.some((gap) => gap.includes("outcome")));
assert.equal(retryOnlySummary.diagnostics.coverage.retries, true);

const invalidJsonResponse = await validateSignalEventRequest(
  new Request("http://localhost/api/events/validate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  }),
);
assert.equal(invalidJsonResponse.status, 400);
assert.equal(invalidJsonResponse.body.code, "invalid_json");

const unsupportedResponse = await validateSignalEventRequest(
  new Request("http://localhost/api/events/validate", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}",
  }),
);
assert.equal(unsupportedResponse.status, 415);

const lookalikeContentTypeResponse = await validateSignalEventRequest(
  new Request("http://localhost/api/events/validate", {
    method: "POST",
    headers: { "content-type": "application/json-patch+json" },
    body: "{}",
  }),
);
assert.equal(lookalikeContentTypeResponse.status, 415);

const tooLargePayload = "x".repeat(SIGNALOPS_EVENT_LIMITS.maxBodyBytes + 1);
assert.equal(getUtf8ByteLength(tooLargePayload), SIGNALOPS_EVENT_LIMITS.maxBodyBytes + 1);
const tooLargeResponse = await validateSignalEventRequest(
  jsonRequest(`"${tooLargePayload}"`, {
    "content-length": String(SIGNALOPS_EVENT_LIMITS.maxBodyBytes + 10),
  }),
);
assert.equal(tooLargeResponse.status, 413);

const actualUtf8TooLargeResponse = await validateSignalEventRequest(
  jsonRequest(JSON.stringify("界".repeat(Math.ceil(SIGNALOPS_EVENT_LIMITS.maxBodyBytes / 3) + 1))),
);
assert.equal(actualUtf8TooLargeResponse.status, 413);

assert.throws(
  () =>
    normalizeSignalEventBatch(
      { events: Array.from({ length: SIGNALOPS_EVENT_LIMITS.maxBatchEvents + 1 }, () => ({})) },
      { currentTimeMs: NOW },
    ),
  /limited to 100 events/,
);

const validResponse = await validateSignalEventRequest(
  jsonRequest(
    JSON.stringify({
      events: [
        {
          type: "generation.started",
          occurredAt: isoOffset(-180_000),
          generationId: "gen_request_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          source: "public-api",
          status: "running",
          user: "ops@signalops.cc",
          prompt: "private prompt",
        },
        {
          type: "generation.retrying",
          occurredAt: isoOffset(-120_000),
          generationId: "gen_request_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          source: "public-api",
          status: "retrying",
          retryCount: 1,
          durationMs: 5100,
        },
        {
          type: "generation.completed",
          occurredAt: isoOffset(-60_000),
          generationId: "gen_request_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          source: "public-api",
          status: "succeeded",
          durationMs: 18340,
          cost: 0.057,
        },
        {
          type: "provider.health",
          occurredAt: isoOffset(-30_000),
          providerId: "fal",
          source: "health-monitor",
          statusMessage: "Recovered",
        },
      ],
    }),
  ),
);

assert.equal(validResponse.status, 200);
const validJson = validResponse.body;
assert.equal(validJson.ok, true);
assert.equal(validJson.verificationOnly, true);
assert.equal(validJson.storedEvents, 0);
assert.equal(validJson.validEvents, 4);
assert.equal(validJson.rejectedEvents, 0);
assert.equal(validJson.acceptedPreview[0].user, "[redacted]");
assert.equal(validJson.acceptedPreview[0].prompt, "[redacted]");

const noValidResponse = await validateSignalEventRequest(
  jsonRequest(
    JSON.stringify({
      events: [
        {
          type: "generation.completed",
          occurredAt: "3026-07-12T12:00:00.000Z",
          generationId: "gen_invalid_001",
          providerId: "fal",
          modelId: "flux-kontext-pro",
          durationMs: -1,
        },
      ],
    }),
  ),
);

assert.equal(noValidResponse.status, 422);
const noValidJson = noValidResponse.body;
assert.equal(noValidJson.ok, false);
assert.equal(noValidJson.validEvents, 0);
assert.equal(noValidJson.rejectedEvents, 1);

console.log("signalops event validator checks passed");

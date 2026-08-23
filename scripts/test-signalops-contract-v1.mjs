import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import {
  SIGNALOPS_V1_LIMITS,
  canonicalSignalOpsEventTextV1,
  normalizeSignalOpsEventBatchV1,
  validateSignalOpsEventV1,
} from "../src/lib/signalops/v1/contract.ts";
import { createMemorySignalOpsEventStoreV1 } from "../src/lib/signalops/v1/event-store.ts";
import { ingestSignalOpsEventsV1 } from "../src/lib/signalops/v1/ingest.ts";
import { SIGNALOPS_V1_EVENT_TYPES } from "../src/lib/signalops/v1/types.ts";
import ingestResponseSchema from "../schemas/ai-telemetry/v1/ingest-response.schema.json" with { type: "json" };

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(scriptDirectory, "../schemas/ai-telemetry/v1/fixtures");

function fixtureFiles(kind) {
  const directory = path.join(fixtureRoot, kind);
  return fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => path.join(directory, name));
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (typeof value !== "object" || value === null) return value;

  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, entry]) => [key, reverseObjectKeys(entry)]),
  );
}

const validFixtures = fixtureFiles("valid").map(readJson);
const invalidFixtures = fixtureFiles("invalid").map(readJson);
const observedTypes = new Set();

function writePrincipal(tenantId) {
  return {
    tenantId,
    credentialId: `credential-${tenantId}`,
    scopes: ["events:write"],
  };
}

for (const fixture of validFixtures) {
  const result = validateSignalOpsEventV1(fixture);
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) observedTypes.add(result.event.type);
}

assert.deepEqual([...observedTypes].sort(), [...SIGNALOPS_V1_EVENT_TYPES].sort());

for (const fixture of invalidFixtures) {
  const result = validateSignalOpsEventV1(fixture);
  assert.equal(result.ok, false, `expected fixture ${fixture.id} to be rejected`);
}

const identityMismatch = invalidFixtures.find(
  (fixture) => fixture.id === "evt_invalid_subject_identity",
);
assert.ok(identityMismatch);
const identityMismatchResult = validateSignalOpsEventV1(identityMismatch);
assert.equal(identityMismatchResult.ok, false);
assert.ok(identityMismatchResult.issues.some((issue) => issue.keyword === "identity"));

const canonicalFixture = validFixtures.find(
  (fixture) => fixture.type === "com.signalops.ai.attempt.terminal.v1",
);
assert.ok(canonicalFixture);
const canonicalResult = validateSignalOpsEventV1(canonicalFixture);
assert.equal(canonicalResult.ok, true);
assert.equal(
  canonicalSignalOpsEventTextV1(canonicalResult.event),
  canonicalSignalOpsEventTextV1(reverseObjectKeys(canonicalFixture)),
);

const emailInAttribute = structuredClone(validFixtures[0]);
emailInAttribute.id = "evt_embedded_email";
emailInAttribute.data.attributes = { ownerLabel: "owner user@example.com" };
const emailResult = validateSignalOpsEventV1(emailInAttribute);
assert.equal(emailResult.ok, false);
assert.ok(emailResult.issues.some((issue) => issue.keyword === "privacy"));

const disguisedPromptKey = structuredClone(validFixtures[0]);
disguisedPromptKey.id = "evt_disguised_prompt";
disguisedPromptKey.data.attributes = { Prompt_Text: "private content" };
const disguisedPromptResult = validateSignalOpsEventV1(disguisedPromptKey);
assert.equal(disguisedPromptResult.ok, false);
assert.ok(disguisedPromptResult.issues.some((issue) => issue.keyword === "privacy"));

for (const forbiddenKey of ["accessToken", "provider_api_key"]) {
  const credentialAttribute = structuredClone(validFixtures[0]);
  credentialAttribute.id = `evt_${forbiddenKey}`;
  credentialAttribute.data.attributes = { [forbiddenKey]: "private credential" };
  const credentialResult = validateSignalOpsEventV1(credentialAttribute);
  assert.equal(credentialResult.ok, false);
  assert.ok(credentialResult.issues.some((issue) => issue.keyword === "privacy"));
}

const authorizationValue = structuredClone(validFixtures[0]);
authorizationValue.id = "evt_authorization_value";
authorizationValue.data.attributes = { diagnostic: "Bearer secret-token-value" };
const authorizationResult = validateSignalOpsEventV1(authorizationValue);
assert.equal(authorizationResult.ok, false);
assert.ok(authorizationResult.issues.some((issue) => issue.keyword === "privacy"));

const mediaUrlValue = structuredClone(validFixtures[0]);
mediaUrlValue.id = "evt_media_url_value";
mediaUrlValue.data.attributes = { diagnostic: "asset at https://media.example/private.png" };
const mediaUrlResult = validateSignalOpsEventV1(mediaUrlValue);
assert.equal(mediaUrlResult.ok, false);
assert.ok(mediaUrlResult.issues.some((issue) => issue.keyword === "privacy"));

const partialBatch = normalizeSignalOpsEventBatchV1([
  validFixtures[0],
  invalidFixtures[0],
]);
assert.equal(partialBatch.events.length, 1);
assert.equal(partialBatch.rejected.length, 1);
assert.equal(partialBatch.rejected[0].index, 1);

assert.throws(
  () => normalizeSignalOpsEventBatchV1({ events: [validFixtures[0]], tenantId: "tenant-other" }),
  /unsupported fields: tenantId/,
);

assert.throws(
  () =>
    normalizeSignalOpsEventBatchV1(
      Array.from({ length: SIGNALOPS_V1_LIMITS.maxBatchEvents + 1 }, () => validFixtures[0]),
    ),
  /limited to 100 events/,
);

const receivedAt = "2026-08-23T05:00:00.000Z";
const store = createMemorySignalOpsEventStoreV1({ receivedAtFactory: () => receivedAt });
const tenantAPrincipal = writePrincipal("tenant-a");
const tenantBPrincipal = writePrincipal("tenant-b");
const firstWrite = await store.store(tenantAPrincipal, [canonicalResult.event]);
assert.deepEqual(firstWrite.storedEventIds, [canonicalResult.event.id]);
assert.deepEqual(firstWrite.duplicateEventIds, []);
assert.deepEqual(firstWrite.conflictEventIds, []);

const duplicateWrite = await store.store(tenantAPrincipal, [reverseObjectKeys(canonicalResult.event)]);
assert.deepEqual(duplicateWrite.storedEventIds, []);
assert.deepEqual(duplicateWrite.duplicateEventIds, [canonicalResult.event.id]);
assert.deepEqual(duplicateWrite.conflictEventIds, []);

const conflictingEvent = structuredClone(canonicalResult.event);
conflictingEvent.time = "2026-08-23T04:30:13.345Z";
const conflictingWrite = await store.store(tenantAPrincipal, [conflictingEvent]);
assert.deepEqual(conflictingWrite.storedEventIds, []);
assert.deepEqual(conflictingWrite.duplicateEventIds, []);
assert.deepEqual(conflictingWrite.conflictEventIds, [canonicalResult.event.id]);

const otherTenantWrite = await store.store(tenantBPrincipal, [canonicalResult.event]);
assert.deepEqual(otherTenantWrite.storedEventIds, [canonicalResult.event.id]);
assert.equal(store.snapshot("tenant-a").length, 1);
assert.equal(store.snapshot("tenant-b").length, 1);
assert.equal(store.snapshot()[0].receivedAt, receivedAt);

const ingestStore = createMemorySignalOpsEventStoreV1({ receivedAtFactory: () => receivedAt });
const ingestPrincipal = writePrincipal("tenant-ingest");
const initialReceipt = await ingestSignalOpsEventsV1({
  principal: ingestPrincipal,
  payload: [canonicalResult.event, invalidFixtures[0]],
  store: ingestStore,
});
assert.deepEqual(initialReceipt, {
  acceptedEvents: 1,
  rejectedEvents: 1,
  storedEvents: 1,
  duplicateEvents: 0,
  conflictEvents: 0,
  storedEventIds: [canonicalResult.event.id],
  duplicateEventIds: [],
  conflictEventIds: [],
  rejected: initialReceipt.rejected,
});
const validateIngestResponse = new Ajv2020({ allErrors: true, strict: true }).compile(
  ingestResponseSchema,
);
assert.equal(
  validateIngestResponse({
    ok: true,
    requestId: "req_123e4567-e89b-42d3-a456-426614174000",
    receipt: initialReceipt,
  }),
  true,
  JSON.stringify(validateIngestResponse.errors),
);
assert.equal(
  validateIngestResponse({
    ok: true,
    requestId: "req_123e4567-e89b-42d3-a456-426614174000",
    receipt: initialReceipt,
    rejected: initialReceipt.rejected,
  }),
  false,
  "the v1 success envelope must remain closed-world",
);

const retryReceipt = await ingestSignalOpsEventsV1({
  principal: ingestPrincipal,
  payload: [canonicalResult.event, conflictingEvent],
  store: ingestStore,
});
assert.equal(retryReceipt.acceptedEvents, 2);
assert.equal(retryReceipt.storedEvents, 0);
assert.equal(retryReceipt.duplicateEvents, 1);
assert.equal(retryReceipt.conflictEvents, 1);
assert.deepEqual(retryReceipt.storedEventIds, []);
assert.deepEqual(retryReceipt.duplicateEventIds, [canonicalResult.event.id]);
assert.deepEqual(retryReceipt.conflictEventIds, [conflictingEvent.id]);

await assert.rejects(
  store.store(writePrincipal("invalid tenant"), [canonicalResult.event]),
  /principal tenantId must be a bounded opaque identifier/,
);

await assert.rejects(
  ingestSignalOpsEventsV1({
    principal: {
      tenantId: "tenant-ingest",
      credentialId: "credential-read-only",
      scopes: ["events:validate"],
    },
    payload: canonicalResult.event,
    store: ingestStore,
  }),
  /principal requires events:write scope/,
);

console.log(
  `signalops v1 contract checks passed (${validFixtures.length} valid, ${invalidFixtures.length} invalid)`,
);

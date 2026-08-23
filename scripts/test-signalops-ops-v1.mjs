import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileSignalOpsEventStoreV1 } from "../src/lib/signalops/v1/file-event-store.ts";
import { buildSignalOpsOpsSnapshotV1 } from "../src/lib/signalops/v1/ops-snapshot.ts";

const fixture = (name) => import(`../schemas/ai-telemetry/v1/fixtures/valid/${name}.json`, {
  with: { type: "json" },
}).then((module) => structuredClone(module.default));

const [accepted, attemptStarted, attemptTerminal, operationTerminal] = await Promise.all([
  fixture("operation-accepted"),
  fixture("attempt-started"),
  fixture("attempt-terminal"),
  fixture("operation-terminal"),
]);
operationTerminal.data.operation = structuredClone(accepted.data.operation);
operationTerminal.subject = accepted.subject;
operationTerminal.data.outcome = { status: "succeeded" };
attemptTerminal.data.operation = structuredClone(accepted.data.operation);
attemptTerminal.subject = accepted.subject;
const tenantId = "phosphene-production";
const principal = {
  tenantId,
  credentialId: "credential-local-dogfood",
  scopes: ["events:write"],
};
const directory = await mkdtemp(path.join(os.tmpdir(), "signalops-v1-"));
const filePath = path.join(directory, "events.jsonl");
const receivedAt = "2026-08-23T06:00:00.000Z";
const store = createFileSignalOpsEventStoreV1({
  filePath,
  receivedAtFactory: () => receivedAt,
});

const first = await store.store(principal, [accepted, attemptTerminal, operationTerminal]);
assert.deepEqual(first.storedEventIds, [accepted.id, attemptTerminal.id, operationTerminal.id]);

const duplicate = await store.store(principal, [operationTerminal]);
assert.deepEqual(duplicate.duplicateEventIds, [operationTerminal.id]);

const conflictEvent = structuredClone(operationTerminal);
conflictEvent.time = "2026-08-23T04:30:13.999Z";
const conflict = await store.store(principal, [conflictEvent]);
assert.deepEqual(conflict.conflictEventIds, [operationTerminal.id]);

const records = await store.list(tenantId);
assert.equal(records.length, 3);
assert.equal((await readFile(filePath, "utf8")).trim().split("\n").length, 3);

const snapshot = buildSignalOpsOpsSnapshotV1({
  tenantId,
  tenantName: "Phosphene",
  range: "24h",
  records,
  now: new Date("2026-08-23T12:00:00.000Z"),
});
assert.equal(snapshot.tenant.name, "Phosphene");
assert.equal(snapshot.totals.events, 3);
assert.equal(snapshot.totals.operations, 1);
assert.equal(snapshot.totals.attempts, 1);
assert.equal(snapshot.totals.operationsWithAttemptTelemetry, 1);
assert.equal(snapshot.totals.succeeded, 1);
assert.equal(snapshot.totals.successRate, 1);
assert.deepEqual(snapshot.coverage.operationAcceptance, { observed: 1, total: 1, ratio: 1 });
assert.deepEqual(snapshot.coverage.operationCompletion, { observed: 1, total: 1, ratio: 1 });
assert.deepEqual(snapshot.coverage.providerAttempts, { observed: 1, total: 1, ratio: 1 });
assert.deepEqual(snapshot.coverage.attemptLifecycle, { observed: 0, total: 1, ratio: 0 });
assert.deepEqual(snapshot.coverage.failureClassification, { observed: 0, total: 0, ratio: null });
assert.deepEqual(snapshot.coverage.failureCodes, { observed: 0, total: 0, ratio: null });
assert.deepEqual(snapshot.coverage.costEvidence, { observed: 1, total: 1, ratio: 1 });
assert.deepEqual(snapshot.failureBreakdown, []);
assert.equal(snapshot.providers[0].providerKey, attemptTerminal.data.route.providerKey);
assert.equal(snapshot.providers[0].p95DurationMs, attemptTerminal.data.metrics.durationMs);
assert.equal(snapshot.timeline.length, 24);
assert.equal(snapshot.timeline[0].start, "2026-08-22T12:00:00.000Z");
assert.equal(snapshot.timeline.at(-1).end, "2026-08-23T12:00:00.000Z");
for (let index = 1; index < snapshot.timeline.length; index += 1) {
  assert.equal(snapshot.timeline[index - 1].end, snapshot.timeline[index].start);
}
const activeBucket = snapshot.timeline.find(
  (bucket) => bucket.start <= accepted.time && accepted.time < bucket.end,
);
assert.ok(activeBucket);
assert.equal(activeBucket.operations, 1);
assert.equal(activeBucket.failedOperations, 0);
assert.equal(activeBucket.attempts, 1);
assert.equal(activeBucket.failedAttempts, 0);
assert.equal(activeBucket.p95DurationMs, operationTerminal.data.metrics.totalDurationMs);
assert.deepEqual(activeBucket.costByCurrency, [
  {
    currency: "USD",
    provider_reported: 0,
    catalog_estimate: 0.053,
    billing_reconciled: 0,
  },
]);
assert.deepEqual(snapshot.models, [
  {
    modelKey: accepted.data.operation.logicalModelKey,
    operations: 1,
    succeeded: 1,
    failed: 0,
    successRate: 1,
    p95DurationMs: operationTerminal.data.metrics.totalDurationMs,
  },
]);
assert.equal(snapshot.recentOperations[0].status, operationTerminal.data.outcome.status);
assert.deepEqual(snapshot.recentFailedOperations, []);
assert.equal(snapshot.freshness.lastReceivedAt, receivedAt);

const failedTerminal = await fixture("operation-terminal");
failedTerminal.data.operation = structuredClone(accepted.data.operation);
failedTerminal.subject = accepted.subject;
const failedSnapshot = buildSignalOpsOpsSnapshotV1({
  tenantId,
  range: "24h",
  now: new Date("2026-08-23T12:00:00.000Z"),
  records: [accepted, failedTerminal].map((event, index) => ({
    tenantId,
    event,
    payloadDigest: `failed-${index}`,
    receivedAt,
  })),
});
assert.equal(failedSnapshot.totals.failed, 1);
assert.equal(failedSnapshot.totals.operationsWithAttemptTelemetry, 0);
assert.deepEqual(failedSnapshot.coverage.failureClassification, {
  observed: 1,
  total: 1,
  ratio: 1,
});
assert.deepEqual(failedSnapshot.coverage.failureCodes, {
  observed: 1,
  total: 1,
  ratio: 1,
});
assert.deepEqual(failedSnapshot.failureBreakdown, [{
  category: failedTerminal.data.outcome.failure.category,
  responsibility: failedTerminal.data.outcome.failure.responsibility,
  operations: 1,
  retryableOperations: 1,
}]);
assert.deepEqual(
  failedSnapshot.recentFailedOperations.map((operation) => ({
    operationId: operation.operationId,
    status: operation.status,
    failureCategory: operation.failureCategory,
    failureCode: operation.failureCode,
    failureRetryable: operation.failureRetryable,
  })),
  [{
    operationId: accepted.data.operation.id,
    status: "failed",
    failureCategory: failedTerminal.data.outcome.failure.category,
    failureCode: failedTerminal.data.outcome.failure.code,
    failureRetryable: failedTerminal.data.outcome.failure.retryable,
  }],
);

for (const [range, expectedBuckets] of [
  ["7d", 28],
  ["30d", 30],
  ["90d", 30],
]) {
  const rangedSnapshot = buildSignalOpsOpsSnapshotV1({
    tenantId,
    range,
    records,
    now: new Date("2026-08-23T12:00:00.000Z"),
  });
  assert.equal(rangedSnapshot.timeline.length, expectedBuckets);
  assert.equal(rangedSnapshot.timeline.at(-1).end, "2026-08-23T12:00:00.000Z");
}

const rangeBoundary = "2026-08-22T12:00:00.000Z";
const boundaryAccepted = structuredClone(accepted);
const boundaryAttemptStarted = structuredClone(attemptStarted);
const boundaryAttemptTerminal = structuredClone(attemptTerminal);
const boundaryOperationTerminal = structuredClone(operationTerminal);
boundaryAttemptStarted.data.attempt = structuredClone(boundaryAttemptTerminal.data.attempt);
boundaryAccepted.time = "2026-08-22T11:59:58.000Z";
boundaryAttemptStarted.time = "2026-08-22T11:59:59.000Z";
boundaryAttemptTerminal.time = "2026-08-22T12:00:01.000Z";
boundaryOperationTerminal.time = "2026-08-22T12:00:02.000Z";
const boundaryRecords = [
  boundaryAccepted,
  boundaryAttemptStarted,
  boundaryAttemptTerminal,
  boundaryOperationTerminal,
].map((event, index) => ({
  tenantId,
  event,
  payloadDigest: `boundary-${index}`,
  receivedAt: `2026-08-22T12:01:0${index}.000Z`,
}));
const boundarySnapshot = buildSignalOpsOpsSnapshotV1({
  tenantId,
  range: "24h",
  records: boundaryRecords,
  now: new Date("2026-08-23T12:00:00.000Z"),
});
assert.equal(boundarySnapshot.timeline[0].start, rangeBoundary);
assert.equal(boundarySnapshot.totals.events, 2);
assert.equal(boundarySnapshot.totals.operations, 0);
assert.equal(boundarySnapshot.totals.attempts, 0);
assert.equal(boundarySnapshot.totals.operationsWithAttemptTelemetry, 0);
assert.equal(boundarySnapshot.totals.succeeded, 0);
assert.deepEqual(boundarySnapshot.totals.costByCurrency, []);
assert.deepEqual(boundarySnapshot.providers, []);
assert.deepEqual(boundarySnapshot.models, []);
assert.deepEqual(boundarySnapshot.recentOperations, []);
assert.deepEqual(boundarySnapshot.recentFailedOperations, []);
assert.ok(
  boundarySnapshot.timeline.every(
    (bucket) =>
      bucket.operations === 0 &&
      bucket.attempts === 0 &&
      bucket.failedOperations === 0 &&
      bucket.failedAttempts === 0 &&
      bucket.costByCurrency.length === 0,
  ),
  "Lifecycle facts that started before the range must not be reassigned to a terminal-time bucket.",
);

const projectionServiceSource = await readFile(
  new URL("../src/lib/signalops/v1/projection-service.ts", import.meta.url),
  "utf8",
);
assert.match(
  projectionServiceSource,
  /store\.watermark\(input\.tenantId\)/,
  "Projection cache invalidation must include lifecycle starts received before the selected range.",
);
assert.match(
  projectionServiceSource,
  /store\.list\(input\.tenantId,\s*\{\s*limit:/,
  "Projection rebuilds must load lifecycle state before the selected range.",
);

console.log("signalops ops v1 checks passed");

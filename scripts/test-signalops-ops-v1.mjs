import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createFileSignalOpsEventStoreV1 } from "../src/lib/signalops/v1/file-event-store.ts";
import { buildSignalOpsOpsSnapshotV1 } from "../src/lib/signalops/v1/ops-snapshot.ts";

const fixture = (name) => import(`../schemas/ai-telemetry/v1/fixtures/valid/${name}.json`, {
  with: { type: "json" },
}).then((module) => structuredClone(module.default));

const [accepted, attemptTerminal, operationTerminal] = await Promise.all([
  fixture("operation-accepted"),
  fixture("attempt-terminal"),
  fixture("operation-terminal"),
]);
operationTerminal.data.operation = structuredClone(accepted.data.operation);
operationTerminal.subject = accepted.subject;
operationTerminal.data.outcome = { status: "succeeded" };
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
assert.equal(snapshot.totals.succeeded, 1);
assert.equal(snapshot.totals.successRate, 1);
assert.equal(snapshot.providers[0].providerKey, attemptTerminal.data.route.providerKey);
assert.equal(snapshot.providers[0].p95DurationMs, attemptTerminal.data.metrics.durationMs);
assert.equal(snapshot.recentOperations[0].status, operationTerminal.data.outcome.status);
assert.equal(snapshot.freshness.lastReceivedAt, receivedAt);

console.log("signalops ops v1 checks passed");

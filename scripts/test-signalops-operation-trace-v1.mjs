import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMemorySignalOpsEventStoreV1 } from "../src/lib/signalops/v1/event-store.ts";
import { createFileSignalOpsEventStoreV1 } from "../src/lib/signalops/v1/file-event-store.ts";
import {
  buildSignalOpsOperationTraceV1,
  isSignalOpsOperationIdV1,
} from "../src/lib/signalops/v1/operation-trace.ts";

const fixture = (name) => import(`../schemas/ai-telemetry/v1/fixtures/valid/${name}.json`, {
  with: { type: "json" },
}).then((module) => structuredClone(module.default));

const [accepted, started, attemptTerminal, operationTerminal] = await Promise.all([
  fixture("operation-accepted"),
  fixture("attempt-started"),
  fixture("attempt-terminal"),
  fixture("operation-terminal"),
]);

attemptTerminal.id = "evt_attempt_attempt_200_terminal";
attemptTerminal.subject = accepted.subject;
attemptTerminal.time = "2026-08-23T04:30:12.000Z";
attemptTerminal.source = accepted.source;
attemptTerminal.data.operation = structuredClone(accepted.data.operation);
attemptTerminal.data.attempt = structuredClone(started.data.attempt);
attemptTerminal.data.route = structuredClone(started.data.route);
attemptTerminal.data.resource = structuredClone(started.data.resource);
operationTerminal.id = "evt_operation_job_100_terminal";
operationTerminal.subject = accepted.subject;
operationTerminal.time = "2026-08-23T04:30:13.000Z";
operationTerminal.source = accepted.source;
operationTerminal.data.operation = structuredClone(accepted.data.operation);
operationTerminal.data.resource = structuredClone(accepted.data.resource);
operationTerminal.data.outcome = { status: "succeeded" };
operationTerminal.data.metrics = { totalDurationMs: 13_000, attemptCount: 1 };

const tenantId = "tenant-alpha";
const receivedAt = "2026-08-23T04:31:00.000Z";
const records = [operationTerminal, attemptTerminal, accepted, started].map((event, index) => ({
  tenantId,
  event,
  payloadDigest: `digest-${index}`,
  receivedAt,
}));

const trace = buildSignalOpsOperationTraceV1({
  tenantId,
  operationId: accepted.data.operation.id,
  records,
});
assert.ok(trace);
assert.equal(trace.operation.id, accepted.data.operation.id);
assert.equal(trace.operation.status, "succeeded");
assert.equal(trace.operation.acceptedAt, accepted.time);
assert.equal(trace.operation.terminalAt, operationTerminal.time);
assert.equal(trace.operation.durationMs, 13_000);
assert.equal(trace.attempts.length, 1);
assert.deepEqual(trace.attempts[0], {
  id: started.data.attempt.id,
  number: 1,
  status: "succeeded",
  startedAt: started.time,
  terminalAt: attemptTerminal.time,
  durationMs: attemptTerminal.data.metrics.durationMs,
  queueDurationMs: attemptTerminal.data.metrics.queueDurationMs ?? null,
  outputUnits: attemptTerminal.data.metrics.outputUnits,
  route: started.data.route,
  resource: started.data.resource,
  failure: undefined,
  cost: attemptTerminal.data.cost,
  traceparent: started.traceparent,
  telemetry: { startedSeen: true, terminalSeen: true },
});
assert.deepEqual(
  trace.events.map((event) => event.type),
  [accepted.type, started.type, attemptTerminal.type, operationTerminal.type],
);
assert.deepEqual(trace.telemetry, {
  complete: true,
  truncated: false,
  acceptedSeen: true,
  operationTerminalSeen: true,
  attemptStarts: 1,
  attemptTerminals: 1,
  pairedAttempts: 1,
  missingAttemptStarts: 0,
  missingAttemptTerminals: 0,
  contradictoryTerminals: 0,
  identityCollisions: 0,
});
assert.doesNotMatch(JSON.stringify(trace), /attributes|mediaType|usageMode/);

const terminalOnlyTrace = buildSignalOpsOperationTraceV1({
  tenantId,
  operationId: accepted.data.operation.id,
  records: [accepted, attemptTerminal, operationTerminal].map((event, index) => ({
    tenantId,
    event,
    payloadDigest: `terminal-only-${index}`,
    receivedAt,
  })),
});
assert.ok(terminalOnlyTrace);
assert.equal(terminalOnlyTrace.telemetry.complete, false);
assert.equal(terminalOnlyTrace.telemetry.missingAttemptStarts, 1);

const contradictoryTerminal = structuredClone(operationTerminal);
contradictoryTerminal.id = "evt_operation_job_100_second_terminal";
contradictoryTerminal.time = "2026-08-23T04:30:14.000Z";
contradictoryTerminal.data.outcome = {
  status: "failed",
  failure: {
    category: "provider_error",
    responsibility: "provider",
    code: "late_contradiction",
    retryable: true,
  },
};
const contradictoryTrace = buildSignalOpsOperationTraceV1({
  tenantId,
  operationId: accepted.data.operation.id,
  records: [...records, {
    tenantId,
    event: contradictoryTerminal,
    payloadDigest: "contradiction",
    receivedAt,
  }],
});
assert.ok(contradictoryTrace);
assert.equal(contradictoryTrace.operation.status, "succeeded");
assert.equal(contradictoryTrace.telemetry.contradictoryTerminals, 1);
assert.equal(contradictoryTrace.telemetry.complete, false);

assert.equal(isSignalOpsOperationIdV1("job_100"), true);
assert.equal(isSignalOpsOperationIdV1("route/client:operation-1"), true);
assert.equal(isSignalOpsOperationIdV1("../job?secret=yes"), false);
assert.equal(isSignalOpsOperationIdV1(""), false);
assert.equal(isSignalOpsOperationIdV1("x".repeat(121)), false);

for (const store of [
  createMemorySignalOpsEventStoreV1({ receivedAtFactory: () => receivedAt }),
  createFileSignalOpsEventStoreV1({
    filePath: path.join(await mkdtemp(path.join(os.tmpdir(), "signalops-trace-v1-")), "events.jsonl"),
    receivedAtFactory: () => receivedAt,
  }),
]) {
  await store.store(
    { tenantId: "tenant-alpha", credentialId: "alpha", scopes: ["events:write"] },
    [accepted, started, attemptTerminal, operationTerminal],
  );
  await store.store(
    { tenantId: "tenant-beta", credentialId: "beta", scopes: ["events:write"] },
    [accepted],
  );
  const alpha = await store.listBySubject("tenant-alpha", accepted.subject);
  const beta = await store.listBySubject("tenant-beta", accepted.subject);
  assert.equal(alpha.length, 4);
  assert.equal(beta.length, 1);
  assert.ok(alpha.every((record) => record.tenantId === "tenant-alpha"));
  assert.ok(beta.every((record) => record.tenantId === "tenant-beta"));
}

const [routeSource, supabaseSource] = await Promise.all([
  readFile(
    new URL("../src/app/v1/ops/operations/[operationId]/route.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/lib/signalops/v1/supabase.ts", import.meta.url), "utf8"),
]);
assert.match(routeSource, /authorizeSignalOpsOperatorSessionV1\(request\)/);
assert.match(routeSource, /tenantId:\s*session\.tenantId/);
assert.match(routeSource, /isSignalOpsOperationIdV1\(operationId\)/);
assert.doesNotMatch(routeSource, /payload|attributes/);
assert.match(supabaseSource, /subject:\s*event\.subject/);
assert.match(supabaseSource, /subject:\s*`eq\.\$\{subject\}`/);

console.log("signalops operation trace v1 checks passed");

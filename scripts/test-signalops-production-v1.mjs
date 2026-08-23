import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  evaluateSignalOpsIncidentsV1,
  syncSignalOpsIncidentsV1,
} from "../src/lib/signalops/v1/incidents.ts";
import {
  buildSignalOpsOpsSnapshotV1,
  DEFAULT_SIGNALOPS_PROJECTION_POLICY_V1,
} from "../src/lib/signalops/v1/ops-snapshot.ts";
import {
  consumeSignalOpsRateLimitV1,
  signalOpsRateLimitKeyV1,
} from "../src/lib/signalops/v1/rate-limit.ts";
import {
  createSignalOpsOperatorSessionTokenV1,
  isSignalOpsOperatorAuthConfiguredV1,
  readSignalOpsOperatorSessionV1,
} from "../src/lib/signalops/v1/session.ts";

const fixture = (name) =>
  import(`../schemas/ai-telemetry/v1/fixtures/valid/${name}.json`, {
    with: { type: "json" },
  }).then((module) => structuredClone(module.default));

const [acceptedFixture, attemptStartedFixture, attemptTerminalFixture, operationTerminalFixture] =
  await Promise.all([
    fixture("operation-accepted"),
    fixture("attempt-started"),
    fixture("attempt-terminal"),
    fixture("operation-terminal"),
  ]);

const tenantId = "production-edge-cases";
const operation = structuredClone(acceptedFixture.data.operation);
const subject = acceptedFixture.subject;
const accepted = structuredClone(acceptedFixture);
const attemptStarted = structuredClone(attemptStartedFixture);
attemptStarted.data.operation = structuredClone(operation);
attemptStarted.subject = subject;
const attemptTerminal = structuredClone(attemptTerminalFixture);
attemptTerminal.data.operation = structuredClone(operation);
attemptTerminal.data.attempt = structuredClone(attemptStarted.data.attempt);
attemptTerminal.subject = subject;
attemptTerminal.data.cost = {
  amount: "0.031",
  currency: "USD",
  source: "provider_reported",
};
const operationTerminal = structuredClone(operationTerminalFixture);
operationTerminal.data.operation = structuredClone(operation);
operationTerminal.subject = subject;
operationTerminal.data.outcome = { status: "succeeded" };
operationTerminal.data.metrics = { totalDurationMs: 61_000, attemptCount: 1 };

function record(event, receivedAt) {
  return {
    tenantId,
    event,
    payloadDigest: event.id.padEnd(64, "0").slice(0, 64),
    receivedAt,
  };
}

const records = [
  record(operationTerminal, "2026-08-23T05:00:04.000Z"),
  record(attemptTerminal, "2026-08-23T05:00:03.000Z"),
  record(accepted, "2026-08-23T05:00:01.000Z"),
  record(attemptStarted, "2026-08-23T05:00:02.000Z"),
];
const snapshot = buildSignalOpsOpsSnapshotV1({
  tenantId,
  range: "24h",
  records,
  now: new Date("2026-08-23T05:05:00.000Z"),
});
assert.equal(snapshot.totals.operations, 1);
assert.equal(snapshot.totals.attempts, 1);
assert.equal(snapshot.recentOperations[0].status, "succeeded");
assert.equal(snapshot.recentOperations[0].durationMs, 61_000);
assert.deepEqual(snapshot.totals.costByCurrency, [
  {
    currency: "USD",
    provider_reported: 0.031,
    catalog_estimate: 0,
    billing_reconciled: 0,
  },
]);

const contradictoryTerminal = structuredClone(operationTerminal);
contradictoryTerminal.id = "evt_operation_job_100_second_terminal";
contradictoryTerminal.time = "2026-08-23T04:32:00.000Z";
contradictoryTerminal.data.outcome = {
  status: "failed",
  failure: {
    category: "provider_timeout",
    responsibility: "provider",
    code: "late_conflicting_terminal",
    retryable: true,
  },
};
const contradictory = buildSignalOpsOpsSnapshotV1({
  tenantId,
  range: "24h",
  records: [...records, record(contradictoryTerminal, "2026-08-23T05:00:05.000Z")],
  now: new Date("2026-08-23T05:05:00.000Z"),
});
assert.equal(contradictory.recentOperations[0].status, "succeeded");
assert.equal(contradictory.dataQuality.contradictoryTerminals, 1);
assert.equal(contradictory.dataQuality.complete, false);

const collidingAttempt = structuredClone(attemptTerminal);
collidingAttempt.id = "evt_attempt_identity_collision";
collidingAttempt.data.operation.id = "job_other";
collidingAttempt.subject = "operation/job_other";
const collision = buildSignalOpsOpsSnapshotV1({
  tenantId,
  range: "24h",
  records: [...records, record(collidingAttempt, "2026-08-23T05:00:06.000Z")],
  now: new Date("2026-08-23T05:05:00.000Z"),
});
assert.equal(collision.dataQuality.identityCollisions, 1);
assert.equal(collision.totals.attempts, 1);

const euroAttempt = structuredClone(attemptTerminal);
euroAttempt.id = "evt_attempt_201_terminal";
euroAttempt.data.attempt.id = "attempt_201";
euroAttempt.data.attempt.number = 2;
euroAttempt.data.cost = { amount: "0.045", currency: "EUR", source: "catalog_estimate" };
const currencies = buildSignalOpsOpsSnapshotV1({
  tenantId,
  range: "24h",
  records: [...records, record(euroAttempt, "2026-08-23T05:00:06.000Z")],
  now: new Date("2026-08-23T05:05:00.000Z"),
});
assert.deepEqual(
  currencies.totals.costByCurrency.map((row) => row.currency),
  ["EUR", "USD"],
);
assert.equal(currencies.totals.attempts, 2);

const failedAttempts = [0, 1].map((index) => {
  const event = structuredClone(attemptTerminal);
  event.id = `evt_failed_attempt_${index}`;
  event.time = `2026-08-23T05:0${index}:00.000Z`;
  event.data.attempt.id = `failed_attempt_${index}`;
  event.data.attempt.number = index + 1;
  event.data.outcome = {
    status: "failed",
    failure: {
      category: "provider_timeout",
      responsibility: "provider",
      code: "provider_deadline",
      retryable: true,
    },
  };
  delete event.data.cost;
  return record(event, `2026-08-23T05:0${index}:01.000Z`);
});
const unhealthy = buildSignalOpsOpsSnapshotV1({
  tenantId: "incident-tenant",
  range: "24h",
  records: failedAttempts.map((item) => ({ ...item, tenantId: "incident-tenant" })),
  now: new Date("2026-08-23T05:05:00.000Z"),
  policy: {
    ...DEFAULT_SIGNALOPS_PROJECTION_POLICY_V1,
    version: "test-policy",
    minimumProviderSample: 2,
    criticalFailureRate: 0.5,
  },
});
assert.equal(unhealthy.providers[0].health.status, "incident");
const decisions = evaluateSignalOpsIncidentsV1(unhealthy);
assert.equal(decisions.length, 1);
const opened = await syncSignalOpsIncidentsV1({
  tenantId: "incident-tenant",
  decisions,
  now: new Date("2026-08-23T05:06:00.000Z"),
});
assert.equal(opened.transitions.length, 1);
assert.equal(opened.transitions[0].state, "open");
const stable = await syncSignalOpsIncidentsV1({
  tenantId: "incident-tenant",
  decisions,
  now: new Date("2026-08-23T05:07:00.000Z"),
});
assert.equal(stable.transitions.length, 0);
const resolved = await syncSignalOpsIncidentsV1({
  tenantId: "incident-tenant",
  decisions: [],
  now: new Date("2026-08-23T05:08:00.000Z"),
});
assert.equal(resolved.transitions.length, 1);
assert.equal(resolved.transitions[0].state, "resolved");

const savedEnv = { ...process.env };
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SECRET_KEY;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SIGNALOPS_RATE_LIMIT_SECRET = "test-rate-limit-secret-that-is-long-enough";
const bucketKey = signalOpsRateLimitKeyV1("production-test", crypto.randomUUID());
assert.equal(
  (await consumeSignalOpsRateLimitV1({ bucketKey, limit: 1, windowSeconds: 60 })).allowed,
  true,
);
assert.equal(
  (await consumeSignalOpsRateLimitV1({ bucketKey, limit: 1, windowSeconds: 60 })).allowed,
  false,
);

process.env.SIGNALOPS_SESSION_SECRET = "old-session-secret-that-is-at-least-thirty-two-bytes";
process.env.SIGNALOPS_WORKSPACE_SLUG = "session-rotation";
process.env.SIGNALOPS_WORKSPACE_NAME = "Session Rotation";
const oldToken = createSignalOpsOperatorSessionTokenV1();
process.env.SIGNALOPS_SESSION_SECRET_PREVIOUS = process.env.SIGNALOPS_SESSION_SECRET;
process.env.SIGNALOPS_SESSION_SECRET = "new-session-secret-that-is-at-least-thirty-two-bytes";
const rotatedSession = readSignalOpsOperatorSessionV1(
  new Request("https://signalops.test/cockpit", {
    headers: { cookie: `signalops_operator_session=${oldToken}` },
  }),
);
assert.equal(rotatedSession?.tenantId, "session-rotation");
delete process.env.SIGNALOPS_SESSION_SECRET_PREVIOUS;
assert.equal(
  readSignalOpsOperatorSessionV1(
    new Request("https://signalops.test/cockpit", {
      headers: { cookie: `signalops_operator_session=${oldToken}` },
    }),
  ),
  null,
);

process.env.NODE_ENV = "production";
process.env.SIGNALOPS_COCKPIT_PASSWORD = "strong-production-password";
delete process.env.SIGNALOPS_ALLOW_PASSWORD_AUTH;
assert.equal(isSignalOpsOperatorAuthConfiguredV1(), false);
process.env.SIGNALOPS_ALLOW_PASSWORD_AUTH = "true";
assert.equal(isSignalOpsOperatorAuthConfiguredV1(), true);

for (const key of Object.keys(process.env)) {
  if (!(key in savedEnv)) delete process.env[key];
}
Object.assign(process.env, savedEnv);

const migration = await readFile(
  new URL("../supabase/migrations/20260823090716_signalops_v1_production_hardening.sql", import.meta.url),
  "utf8",
);
assert.match(migration, /enable row level security/g);
assert.match(migration, /signalops_v1_consume_rate_limit/);
assert.match(migration, /signalops_v1_apply_retention/);
assert.match(migration, /v_now timestamptz := clock_timestamp\(\)/);
assert.doesNotMatch(migration, /current_time timestamptz/);
assert.match(migration, /from public, anon, authenticated/);
assert.match(migration, /to service_role/);

console.log("signalops production hardening checks passed");

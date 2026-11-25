import assert from "node:assert/strict";
import {
  buildSignalOpsCurlQuickstartV1,
  buildSignalOpsRawHttpQuickstartV1,
  signalOpsQuickstartOperationEventsV1,
} from "../src/lib/signalops/v1/quickstart.ts";

const ENDPOINT = "https://ingest.signalops.cc/v1/events";
const SERVICE = "billing-worker";
const OPERATION = "op_1764048000";
const TIME = "2026-11-25T03:20:00.000Z";
const DATASCHEMA = "https://signalops.cc/schemas/ai-telemetry/v1";

function assertEnvelopeV1(event, { operationId, service, boundary, type }) {
  assert.equal(event.specversion, "1.0", `specversion on ${boundary}`);
  assert.equal(event.id, `evt_${operationId}_${boundary}`, `id on ${boundary}`);
  assert.equal(event.source, `urn:quickstart:${service}`, `source on ${boundary}`);
  assert.equal(event.type, type, `type on ${boundary}`);
  assert.equal(event.subject, `operation/${operationId}`, `subject on ${boundary}`);
  assert.equal(event.datacontenttype, "application/json", `datacontenttype on ${boundary}`);
  assert.equal(event.dataschema, DATASCHEMA, `dataschema on ${boundary}`);
  assert.ok(
    typeof event.time === "string" && event.time.length > 0,
    `time on ${boundary}`,
  );
  assert.equal(event.data.operation.id, operationId, `operation id on ${boundary}`);
  assert.equal(event.data.operation.kind, "text_generation", `operation kind on ${boundary}`);
  assert.equal(
    event.data.operation.logicalModelKey,
    "quickstart-model",
    `logicalModelKey on ${boundary}`,
  );
  assert.deepEqual(
    event.data.resource,
    { environment: "production", service },
    `resource on ${boundary}`,
  );
}

// --- Event contract: exactly the two lifecycle boundaries a first signal needs ---

const events = signalOpsQuickstartOperationEventsV1({
  operationId: OPERATION,
  time: TIME,
  service: `  ${SERVICE}  `,
});
assert.equal(events.length, 2, "exactly two quickstart events");
assertEnvelopeV1(events[0], {
  operationId: OPERATION,
  service: SERVICE,
  boundary: "accepted",
  type: "com.signalops.ai.operation.accepted.v1",
});
assertEnvelopeV1(events[1], {
  operationId: OPERATION,
  service: SERVICE,
  boundary: "terminal",
  type: "com.signalops.ai.operation.terminal.v1",
});
assert.deepEqual(events[1].data.outcome, { status: "succeeded" }, "terminal outcome");
assert.deepEqual(
  events[1].data.metrics,
  { totalDurationMs: 480, attemptCount: 1 },
  "terminal metrics",
);

// Default service when omitted or blank.
const defaultService = signalOpsQuickstartOperationEventsV1({
  operationId: OPERATION,
  time: TIME,
})[0].data.resource.service;
assert.equal(defaultService, "generation-worker", "default service");
const blankService = signalOpsQuickstartOperationEventsV1({
  operationId: OPERATION,
  time: TIME,
  service: "   ",
})[0].data.resource.service;
assert.equal(blankService, "generation-worker", "blank service falls back to default");

// --- Input sanitization (both builders share it) ---

const unsafeInputs = [
  { label: "credentials", endpoint: "https://user:pass@ingest.signalops.cc/v1/events" },
  { label: "query", endpoint: `${ENDPOINT}?debug=1` },
  { label: "fragment", endpoint: `${ENDPOINT}#fragment` },
  { label: "leading-dot service", endpoint: ENDPOINT, service: ".hidden-worker" },
  { label: "space service", endpoint: ENDPOINT, service: "billing worker" },
  { label: "121-char service", endpoint: ENDPOINT, service: "a".repeat(121) },
];
for (const builder of [buildSignalOpsCurlQuickstartV1, buildSignalOpsRawHttpQuickstartV1]) {
  for (const unsafe of unsafeInputs) {
    assert.throws(
      () => builder(unsafe),
      TypeError,
      `${builder.name} must reject ${unsafe.label}`,
    );
  }
}

// --- curl quickstart: shell placeholders, ms-precision NOW, parseable heredoc JSON ---

const curl = buildSignalOpsCurlQuickstartV1({ endpoint: ENDPOINT, service: SERVICE });
assert.ok(curl.includes('OPERATION="op_$(date +%s)"'), "shell OPERATION placeholder");
assert.ok(
  curl.includes('NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'),
  "ms-precision NOW placeholder (V1 envelope requires milliseconds)",
);
assert.ok(curl.includes(`curl -sS ${ENDPOINT} \\`), "endpoint interpolated into curl");
assert.ok(
  curl.includes('-H "authorization: Bearer $SIGNALOPS_INGEST_CREDENTIAL"'),
  "credential stays a shell env placeholder, never a literal",
);
assert.ok(curl.includes('-H "content-type: application/json"'), "json content-type header");

// The unquoted heredoc expands ${OPERATION} and ${NOW}; simulate the shell, parse the JSON.
const expanded = curl.replaceAll("${OPERATION}", OPERATION).replaceAll("${NOW}", TIME);
const heredoc = expanded.slice(expanded.indexOf("<<JSON\n") + "<<JSON\n".length);
const body = heredoc.slice(0, heredoc.lastIndexOf("\nJSON"));
const parsed = JSON.parse(body);
assert.deepEqual(
  parsed.events,
  signalOpsQuickstartOperationEventsV1({
    operationId: OPERATION,
    time: TIME,
    service: SERVICE,
  }),
  "curl heredoc JSON matches the V1 quickstart event contract",
);

// --- raw HTTP quickstart: valid standalone JS with the four-boundary walk ---

const raw = buildSignalOpsRawHttpQuickstartV1({ endpoint: ENDPOINT, service: SERVICE });
assert.ok(
  raw.includes(`const endpoint = ${JSON.stringify(ENDPOINT)};`),
  "endpoint JSON-stringified",
);
assert.ok(raw.includes(`urn:quickstart:${SERVICE}`), "service in source URN");
assert.ok(
  raw.includes('process.env.SIGNALOPS_INGEST_CREDENTIAL') &&
    raw.includes('throw new Error("SIGNALOPS_INGEST_CREDENTIAL is required")'),
  "credential read from env and required",
);
assert.ok(
  raw.includes("authorization: `Bearer ${credential}`"),
  "bearer header built from the env credential",
);
assert.ok(raw.includes("result.receipt.storedEvents"), "receipt confirmation surfaced");
assert.ok(!raw.includes("Bearer undefined"), "no resolved credential leaks into the snippet");

const rawEventTypes = [
  "com.signalops.ai.operation.accepted.v1",
  "com.signalops.ai.attempt.started.v1",
  "com.signalops.ai.attempt.terminal.v1",
  "com.signalops.ai.operation.terminal.v1",
];
let cursor = -1;
for (const type of rawEventTypes) {
  cursor = raw.indexOf(`"${type}"`, cursor + 1);
  assert.ok(cursor !== -1, `raw snippet emits ${type}`);
}
const operationTerminal = raw.indexOf('"com.signalops.ai.operation.accepted.v1"');
const operationAccepted = operationTerminal;
assert.equal(
  raw.indexOf('"com.signalops.ai.attempt.started.v1"') > operationAccepted,
  true,
  "attempt events follow the operation acceptance",
);

// The raw snippet must be syntactically valid JavaScript (it is the pilot's first copy-paste).
// Top-level await is legal in an .mjs, so node --check parses the snippet verbatim.
const { execFileSync } = await import("node:child_process");
const { writeFileSync, unlinkSync } = await import("node:fs");
const tmp = `${process.env.TMPDIR ?? "/tmp"}/signalops-quickstart-${process.pid}.mjs`;
writeFileSync(tmp, raw);
try {
  const syntax = execFileSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
  assert.equal(syntax, "", "raw quickstart snippet parses as JavaScript");
} finally {
  unlinkSync(tmp);
}

console.log(
  "Quickstart V1 contract OK: envelope discipline, input sanitization, shell placeholders, and a parseable first-run snippet.",
);

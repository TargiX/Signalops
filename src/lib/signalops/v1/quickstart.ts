export function buildSignalOpsRawHttpQuickstartV1(input: {
  endpoint: string;
  service?: string;
}): string {
  const endpoint = new URL(input.endpoint);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError("SignalOps endpoint must not contain credentials, query, or fragment");
  }
  const service = input.service?.trim() || "generation-worker";
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(service)) {
    throw new TypeError("SignalOps service must be a bounded opaque key");
  }
  return `const endpoint = ${JSON.stringify(endpoint.toString())};
const credential = process.env.SIGNALOPS_INGEST_CREDENTIAL;
if (!credential) throw new Error("SIGNALOPS_INGEST_CREDENTIAL is required");

const operationId = \`quickstart_\${crypto.randomUUID()}\`;
const attemptId = \`attempt_\${crypto.randomUUID()}\`;
const source = ${JSON.stringify(`urn:quickstart:${service}`)};
const resource = {
  environment: "production",
  service: ${JSON.stringify(service)},
};
const operation = {
  id: operationId,
  kind: "text_generation",
  logicalModelKey: "quickstart-model",
};
const route = {
  providerKey: "primary",
  providerVendor: "example",
  modelKey: "quickstart-model",
  providerModelKey: "example-model-v1",
};
const envelope = (boundary, type, data) => ({
  specversion: "1.0",
  id: \`evt_\${operationId}_\${boundary}\`,
  source,
  type,
  subject: \`operation/\${operationId}\`,
  time: new Date().toISOString(),
  datacontenttype: "application/json",
  dataschema: "https://signalops.cc/schemas/ai-telemetry/v1",
  data,
});

const events = [
  envelope("accepted", "com.signalops.ai.operation.accepted.v1", {
    operation,
    resource,
  }),
  envelope("attempt_started", "com.signalops.ai.attempt.started.v1", {
    operation,
    attempt: { id: attemptId, number: 1 },
    route,
    resource,
  }),
  envelope("attempt_terminal", "com.signalops.ai.attempt.terminal.v1", {
    operation,
    attempt: { id: attemptId, number: 1 },
    route,
    outcome: { status: "succeeded" },
    metrics: { durationMs: 420, outputUnits: 1 },
    cost: { amount: "0.001", currency: "USD", source: "provider_reported" },
    resource,
  }),
  envelope("terminal", "com.signalops.ai.operation.terminal.v1", {
    operation,
    outcome: { status: "succeeded" },
    metrics: { totalDurationMs: 480, attemptCount: 1 },
    resource,
  }),
];

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: \`Bearer \${credential}\`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ events }),
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(JSON.stringify(result));
console.log("SignalOps accepted", result.receipt.storedEvents, "events for", operationId);`;
}

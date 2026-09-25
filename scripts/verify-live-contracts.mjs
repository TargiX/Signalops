#!/usr/bin/env node

import assert from "node:assert/strict";

const baseUrl = process.env.SIGNALOPS_BASE_URL || "https://signalops.cc";

async function request(path, init) {
  const response = await fetch(new URL(path, baseUrl), init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function requestManual(path, init) {
  const response = await fetch(new URL(path, baseUrl), { ...init, redirect: "manual" });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

const status = await request("/api/status");
assert.equal(status.response.status, 200, "status endpoint must be reachable");
assert.equal(status.body.stage, "hosted_demo", "live deployment must honestly remain hosted_demo until cutover");
assert.equal(status.body.canValidateEvents, true, "public validation must be available");
assert.equal(status.body.canAcceptSourceEvents, false, "source ingest must stay blocked without durable storage");

const home = await request("/");
assert.equal(home.response.status, 200, "home page must be reachable");
assert.match(String(home.body), /D1\/Supabase path ready/, "home page must describe storage as a path, not connected storage");
assert.doesNotMatch(
  String(home.body),
  /Durable-store ready/,
  "home page must not imply durable storage is connected while live storage is memory",
);
assert.match(String(home.body), /Demo Snapshot/, "home page must label seeded data as a demo snapshot");
assert.match(String(home.body), /pilot preview/, "home page must label the current maturity as a pilot preview");
assert.doesNotMatch(String(home.body), /SignalOps OS/, "home page must not overstate the product as an OS");
assert.doesNotMatch(String(home.body), /v2\.0/, "home page must not imply a mature version while in hosted-demo mode");
assert.doesNotMatch(
  String(home.body),
  /Agentic AI Infrastructure/,
  "home page must use concrete product framing instead of inflated category language",
);

const statusPage = await request("/status");
assert.equal(statusPage.response.status, 200, "status page must be reachable");
assert.match(String(statusPage.body), /Hosted demo, not production-ready/, "status page must state the public claim boundary");
assert.match(String(statusPage.body), /Source ingest blocked/, "status page must expose source ingest as blocked before storage");
assert.match(String(statusPage.body), /Pilot intake guarded/, "status page must explain guarded pilot intake");

if (status.body.requirements?.cockpitAuth) {
  const cockpit = await requestManual("/cockpit");
  assert.equal(cockpit.response.status, 200, "demo cockpit must stay public even when operator auth is enabled");

  const snapshot = await request("/api/snapshot?range=24h");
  assert.equal(snapshot.response.status, 200, "snapshot API must return the public demo snapshot when auth is enabled");
  assert.equal(snapshot.body.sourceOverlay.demoDataIncluded, true, "public snapshot must remain visibly demo-backed");
  assert.equal(snapshot.body.sourceOverlay.sourceEventsIncluded, false, "public snapshot must not expose source overlay");
}

const health = await request("/api/health");
assert.equal(health.response.status, 200, "health endpoint must be reachable");
assert.equal(typeof health.body.publicBaseUrl?.ready, "boolean", "health must expose public base URL readiness");
assert.equal(health.body.eventValidation.ready, true, "event validation must be ready");
assert.equal(health.body.eventValidation.storesEvents, false, "event validation must not store events");
assert.equal(health.body.eventIngest.ready, false, "event ingest must stay blocked before durable storage/token");
assert.equal(typeof health.body.eventIngest.alertWebhook, "boolean", "health must expose alert webhook readiness");
assert.equal(health.body.eventIngest.policy.maxBatchEvents, 100, "health must expose the ingest batch limit");
assert.equal(health.body.eventIngest.policy.maxBodyBytes, 262144, "health must expose the ingest body limit");
assert.equal(health.body.eventIngest.policy.privacyMode, "redact", "health must expose redacted ingest privacy mode");
assert.equal(typeof health.body.workspace.workspaceSlug, "string", "health must expose workspace slug");
if (health.body.workspace.workspaceSlug === "demo") {
  assert.equal(health.body.workspace.pilotReady, false, "demo workspace must not be pilot-ready");
}
assert.equal(health.body.privacy.ready, true, "health must mark redacted privacy mode as ready");
assert.equal(health.body.privacy.mode, "redact", "health must expose the active privacy mode");
assert.equal(
  health.body.pilotIntake.ready,
  status.body.canAcceptPilotRequests,
  "pilot intake readiness must agree between status and health",
);
assert.equal(
  health.body.pilotIntake.allowsEphemeralStorage,
  false,
  "live pilot intake must not allow ephemeral memory storage",
);
assert.equal(health.body.pilotIntake.maxBodyBytes, 32768, "health must expose the pilot intake body limit");
assert.equal(health.body.pilotIntake.deliveryTimeoutMs, 5000, "health must expose the delivery timeout");
assert.equal(health.body.firstSourceEvent.ready, false, "live health must not claim first source evidence before cutover");
assert.equal(
  health.body.nextExternalSteps.includes("send_first_real_source_event"),
  true,
  "live health must keep first source event as an external step before cutover",
);

const docs = await request("/docs");
assert.equal(docs.response.status, 200, "docs page must be reachable");
assert.match(String(docs.body), /Event validator/, "docs page must expose the public event validator playground");
assert.match(String(docs.body), /probe-supabase/, "docs page must document the Supabase durable-store path");

const sourceKit = await request("/api/source-kit");
assert.equal(sourceKit.response.status, 200, "source kit endpoint must be reachable");
assert.equal(sourceKit.body.ok, true, "source kit must return ok");
assert.equal(sourceKit.body.kit.product, "SignalOps", "source kit must identify SignalOps");
assert.equal(sourceKit.body.kit.packageName, "@signalops/node", "source kit must expose the Node helper package");
assert.equal(sourceKit.body.kit.distribution.npmPublished, false, "source kit must not claim unpublished npm distribution");
assert.equal(
  sourceKit.body.kit.compatibility.validationResultIncludesIngestPolicy,
  true,
  "source kit must expose SDK/API compatibility notes",
);
assert.equal(
  sourceKit.body.kit.compatibility.validationResultIncludesDiagnostics,
  true,
  "source kit must expose validation diagnostics compatibility",
);
assert.equal(sourceKit.body.kit.ingestPolicy.maxBatchEvents, 100, "source kit must expose the batch limit");
assert.ok(
  sourceKit.body.kit.requiredServerEnv.includes("SIGNALOPS_INGEST_TOKEN"),
  "source kit must list the server-side ingest token env",
);
assert.ok(
  sourceKit.body.kit.requiredServerEnv.includes("SIGNALOPS_WORKSPACE_SLUG"),
  "source kit must list the real workspace slug env",
);
assert.ok(
  sourceKit.body.kit.operatorEnv.includes("SIGNALOPS_OPERATOR_TOKEN"),
  "source kit must list the operator token env for protected reports",
);
assert.ok(
  sourceKit.body.kit.verification.readinessGates.includes("first_source_event"),
  "source kit must expose the first real source event readiness gate",
);
assert.ok(
  sourceKit.body.kit.verification.readinessGates.includes("workspace_identity"),
  "source kit must expose the real workspace identity readiness gate",
);
assert.ok(
  sourceKit.body.kit.verification.readinessGates.includes("privacy_mode"),
  "source kit must expose the sensitive-field redaction readiness gate",
);
assert.match(
  sourceKit.body.kit.verification.commands.strictPreflight,
  /--require-pilot-ready/,
  "source kit must expose the strict pilot-ready preflight command",
);
assert.match(
  sourceKit.body.kit.verification.commands.sourceReportJson,
  /source-report/,
  "source kit must expose a protected source-report verification command",
);
assert.match(
  sourceKit.body.kit.snippets.node,
  /providerHealth/,
  "source kit must show provider health SDK telemetry",
);
assert.match(sourceKit.body.kit.snippets.node, /costRecorded/, "source kit must show cost SDK telemetry");
assert.match(sourceKit.body.kit.snippets.node, /createSignalOpsEventId/, "source kit must show idempotent event ids");
assert.equal(
  sourceKit.body.kit.compatibility.ingestResponseIncludesDuplicateEventIds,
  true,
  "source kit must expose duplicate event ids in ingest responses",
);
assert.equal(
  sourceKit.body.kit.idempotency.helper.name,
  "createSignalOpsEventId",
  "source kit must expose the SDK idempotency helper",
);
assert.equal(
  sourceKit.body.kit.pilotIntakePolicy.maxBodyBytes,
  32768,
  "source kit must expose pilot intake body limits",
);
assert.equal(
  sourceKit.body.kit.pilotIntakePolicy.deliveryTimeoutMs,
  5000,
  "source kit must expose pilot delivery timeout",
);
assert.equal(
  sourceKit.body.kit.storageStrategy.mode,
  "reuse_existing_resource",
  "source kit must expose the existing-resource storage strategy",
);
assert.equal(
  sourceKit.body.kit.storageStrategy.newResourcesAllowed,
  false,
  "source kit must not allow creating new cloud resources from the pilot workflow",
);
assert.match(
  sourceKit.body.kit.storageStrategy.discoveryCommand,
  /--existing-only/,
  "source kit D1 discovery must stay in existing-only mode",
);

const pilotPage = await request("/pilot");
assert.equal(pilotPage.response.status, 200, "pilot page must be reachable");
assert.match(
  String(pilotPage.body),
  /copyable pilot package/,
  "pilot page must explain the fail-closed package fallback",
);
assert.match(
  String(pilotPage.body),
  /volume, providers, pain, urgency, and success criteria/,
  "pilot page must qualify real generation workflow fit",
);

const setupPlan = await request("/api/setup-plan");
assert.equal(setupPlan.response.status, 200, "setup plan endpoint must be reachable");
assert.equal(setupPlan.body.ok, true, "setup plan must return ok");
assert.equal(setupPlan.body.plan.stage, "hosted_demo", "setup plan must agree with hosted_demo stage");
assert.equal(setupPlan.body.plan.totalCount, 10, "setup plan must expose the ten cutover gates");
assert.ok(
  setupPlan.body.plan.gates.some((gate) => gate.id === "public_base_url"),
  "setup plan must include the public base URL gate",
);
assert.ok(
  setupPlan.body.plan.gates.some((gate) => gate.id === "secret_boundaries"),
  "setup plan must include the secret-boundary gate",
);
assert.ok(
  setupPlan.body.plan.gates.some((gate) => gate.id === "workspace_identity"),
  "setup plan must include a real workspace identity gate",
);
assert.ok(
  setupPlan.body.plan.gates.some((gate) => gate.id === "privacy_mode"),
  "setup plan must include a sensitive-field redaction gate",
);
assert.ok(
  setupPlan.body.plan.nextExternalSteps.includes("durable_storage"),
  "setup plan must include durable storage as a blocker",
);
assert.ok(
  setupPlan.body.plan.nextExternalSteps.includes("operator_access") ||
    status.body.requirements?.operatorApiToken ||
    status.body.requirements?.cockpitAuth,
  "setup plan must include operator access as a blocker until operator auth is configured",
);
if (status.body.canAcceptPilotRequests) {
  assert.equal(health.body.pilotIntake.ready, true, "pilot intake must be ready when status allows requests");
} else {
  assert.ok(
    setupPlan.body.plan.nextExternalSteps.includes("pilot_delivery"),
    "setup plan must include pilot delivery as a blocker",
  );
}

const openapi = await request("/api/openapi");
assert.equal(openapi.response.status, 200, "OpenAPI endpoint must be reachable");
assert.equal(openapi.body.openapi, "3.1.0", "OpenAPI endpoint must return a 3.1 spec");
for (const path of [
  "/api/status",
  "/api/health",
  "/api/setup-plan",
  "/api/events/validate",
  "/api/events",
  "/api/source-report",
  "/api/pilot-requests",
]) {
  assert.ok(openapi.body.paths[path], `OpenAPI spec must document ${path}`);
}
assert.equal(
  openapi.body.components.schemas.EventValidationResponse.properties.storedEvents.const,
  0,
  "OpenAPI spec must document that validation stores zero events",
);

const validation = await request("/api/events/validate", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "generation.completed",
    generationId: "gen_live_contract_verify",
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "succeeded",
  }),
});
assert.equal(validation.response.status, 200, "event validation must accept valid dry-run events");
assert.equal(validation.body.verificationOnly, true, "event validation must be marked verification-only");
assert.equal(validation.body.ingestPolicy.maxBatchEvents, 100, "validation must echo the ingest batch limit");
assert.equal(validation.body.storedEvents, 0, "event validation must not store events");
assert.equal(validation.body.validEvents, 1, "event validation must report one valid event");
assert.ok(validation.body.diagnostics, "event validation must return diagnostics");
assert.ok(
  ["insufficient", "partial", "pilot_ready"].includes(validation.body.diagnostics.readiness),
  "event validation diagnostics must return stable readiness",
);

const ingest = await request("/api/events", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    type: "generation.completed",
    generationId: "gen_live_contract_blocked",
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "succeeded",
  }),
});
assert.equal(ingest.response.status, 401, "unauthenticated ingest must be rejected");
assert.equal(ingest.body.code, "unauthorized", "unauthenticated ingest must return a stable unauthorized code");

if (!status.body.canAcceptPilotRequests) {
  const pilot = await request("/api/pilot-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Contract Verify",
      email: "verify@example.com",
      company: "SignalOps Check",
      generationVolume: "10k images/month",
      providers: "fal, OpenAI",
      primaryPain: "Retry storms and cost drift are hard to triage before users complain.",
      urgency: "this_month",
      desiredOutcome: "Validate provider health, latency, retries, and cost from a source app without claiming production readiness.",
      useCase: "We run image generation jobs and need latency, retry, and cost visibility before a pilot.",
    }),
  });
  assert.equal(pilot.response.status, 503, "pilot intake must fail closed before delivery/storage");
  assert.equal(pilot.body.code, "pilot_intake_not_configured", "pilot intake must expose the fail-closed code");
  assert.equal(pilot.body.qualification.tier, "strong_fit", "pilot intake must still return deterministic qualification");
  assert.ok(
    pilot.body.qualification.signals.includes("near_term_need"),
    "pilot qualification must include urgency-derived signals",
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      baseUrl,
      stage: status.body.stage,
      setupReady: `${setupPlan.body.plan.readyCount}/${setupPlan.body.plan.totalCount}`,
      openapiPaths: Object.keys(openapi.body.paths).length,
      cockpitAuth: Boolean(status.body.requirements?.cockpitAuth),
      pilotIntakeReady: Boolean(status.body.canAcceptPilotRequests),
      sourceSmoke: "validation_and_unauth_ingest_checked",
      blockers: setupPlan.body.plan.nextExternalSteps,
    },
    null,
    2,
  ),
);

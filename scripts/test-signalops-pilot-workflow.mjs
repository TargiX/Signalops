import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = "3037";
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const server = spawn(command, ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  env: {
    ...process.env,
    SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE: "true",
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "workflow-password",
    SIGNALOPS_INGEST_TOKEN: "sop_ingest_workflow",
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator_workflow",
    VERCEL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function stopServer() {
  if (server.exitCode == null && !server.killed) {
    server.kill("SIGTERM");
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Next is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Next dev server did not become ready.\n${output}`);
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.json();
  return { response, body };
}

async function requestText(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const body = await response.text();
  return { response, body };
}

function withOperatorAuth(init = {}) {
  return {
    ...init,
    headers: {
      authorization: "Bearer sop_operator_workflow",
      ...(init.headers ?? {}),
    },
  };
}

function withIngestAuth(init = {}) {
  return {
    ...init,
    headers: {
      authorization: "Bearer sop_ingest_workflow",
      ...(init.headers ?? {}),
    },
  };
}

try {
  await waitForServer();
  const now = Date.now();

  const setupPlan = await request("/api/setup-plan");
  assert.equal(setupPlan.response.status, 200);
  assert.equal(setupPlan.body.plan.totalCount, 10);
  assert.ok(setupPlan.body.plan.gates.some((gate) => gate.id === "public_base_url"));
  assert.ok(setupPlan.body.plan.gates.some((gate) => gate.id === "secret_boundaries" && gate.ready === true));
  assert.ok(setupPlan.body.plan.gates.some((gate) => gate.id === "workspace_identity"));
  assert.ok(setupPlan.body.plan.gates.some((gate) => gate.id === "privacy_mode"));
  assert.equal(
    setupPlan.body.plan.gates.some((gate) => gate.id === "operator_access" && gate.ready === true),
    true,
  );
  const setupPage = await requestText("/setup");
  assert.equal(setupPage.response.status, 200);
  assert.match(setupPage.body, /docs\/signalops-env\.template/);
  assert.match(setupPage.body, /verify:env-template/);

  const initialHealth = await request("/api/health");
  assert.equal(initialHealth.response.status, 200);
  assert.equal(initialHealth.body.firstSourceEvent.ready, false);
  assert.equal(initialHealth.body.firstSourceEvent.durable, false);
  assert.equal(initialHealth.body.workspace.workspaceSlug, "demo");
  assert.equal(initialHealth.body.workspace.pilotReady, false);
  assert.equal(initialHealth.body.publicBaseUrl.ready, false);
  assert.equal(initialHealth.body.nextExternalSteps.includes("set_signalops_public_base_url"), true);
  assert.equal(initialHealth.body.privacy.ready, true);
  assert.equal(initialHealth.body.privacy.mode, "redact");
  assert.deepEqual(initialHealth.body.eventValidation.rateLimit, {
    mode: "instance_memory",
    windowMs: 60000,
    limit: 60,
  });
  assert.deepEqual(initialHealth.body.eventIngest.rateLimit, {
    mode: "instance_memory",
    windowMs: 60000,
    limit: 120,
  });
  assert.equal(initialHealth.body.pilotIntake.maxBodyBytes, 32768);
  assert.equal(initialHealth.body.pilotIntake.maxBodyKb, 32);
  assert.equal(initialHealth.body.pilotIntake.deliveryTimeoutMs, 5000);
  assert.deepEqual(initialHealth.body.pilotIntake.rateLimit, {
    mode: "instance_memory",
    windowMs: 60000,
    limit: 10,
  });
  assert.deepEqual(initialHealth.body.pilotIntake.acceptedContentTypes, [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ]);
  assert.equal(initialHealth.body.nextExternalSteps.includes("set_signalops_workspace_slug"), true);
  assert.equal(initialHealth.body.nextExternalSteps.includes("send_first_real_source_event"), true);

  const sourceKit = await request("/api/source-kit");
  assert.equal(sourceKit.response.status, 200);
  assert.match(sourceKit.body.kit.snippets.node, /generationRetrying/);
  assert.match(sourceKit.body.kit.snippets.node, /providerHealth/);
  assert.match(sourceKit.body.kit.snippets.node, /costRecorded/);
  assert.equal(sourceKit.body.kit.compatibility.ingestResponseIncludesReceipt, true);
  assert.equal(sourceKit.body.kit.compatibility.ingestResponseIncludesDuplicateEventIds, true);
  assert.equal(sourceKit.body.kit.idempotency.helper.name, "createSignalOpsEventId");
  assert.equal(sourceKit.body.kit.storageStrategy.mode, "reuse_existing_resource");
  assert.equal(sourceKit.body.kit.storageStrategy.newResourcesAllowed, false);
  assert.match(sourceKit.body.kit.storageStrategy.discoveryCommand, /--existing-only/);
  assert.equal(sourceKit.body.kit.pilotIntakePolicy.maxBodyBytes, 32768);
  assert.equal(sourceKit.body.kit.pilotIntakePolicy.deliveryTimeoutMs, 5000);
  assert.equal(sourceKit.body.kit.rateLimitPolicy.mode, "instance_memory");
  assert.equal(sourceKit.body.kit.rateLimitPolicy.buckets.event_validation, 60);
  assert.equal(sourceKit.body.kit.rateLimitPolicy.buckets.event_ingest, 120);
  assert.equal(sourceKit.body.kit.rateLimitPolicy.buckets.pilot_request, 10);
  assert.deepEqual(sourceKit.body.kit.pilotIntakePolicy.acceptedContentTypes, [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ]);
  assert.match(sourceKit.body.kit.snippets.node, /createSignalOpsEventId/);
  assert.match(sourceKit.body.kit.snippets.node, /receipt\?\.proof/);
  assert.ok(sourceKit.body.kit.requiredServerEnv.includes("SIGNALOPS_WORKSPACE_SLUG"));
  assert.deepEqual(sourceKit.body.kit.operatorEnv, ["SIGNALOPS_OPERATOR_TOKEN"]);
  assert.ok(sourceKit.body.kit.verification.readinessGates.includes("public_base_url"));
  assert.ok(sourceKit.body.kit.verification.readinessGates.includes("workspace_identity"));
  assert.ok(sourceKit.body.kit.verification.readinessGates.includes("privacy_mode"));
  assert.ok(sourceKit.body.kit.verification.readinessGates.includes("secret_boundaries"));
  assert.ok(sourceKit.body.kit.verification.readinessGates.includes("first_source_event"));
  assert.match(sourceKit.body.kit.verification.commands.sourceSmoke, /verify:source-smoke/);
  assert.match(sourceKit.body.kit.verification.commands.sourceReportByEvent, /--event-id/);
  assert.match(sourceKit.body.kit.verification.commands.strictPreflight, /--require-pilot-ready/);

  const validation = await request("/api/events/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      events: [
        {
          type: "generation.completed",
          generationId: "gen_http_validate",
          providerId: "fal",
          modelId: "flux-2-pro",
          status: "succeeded",
          durationMs: 18420,
          cost: 0.052,
          retryCount: 1,
        },
        {
          type: "provider.health",
          providerId: "fal",
        },
      ],
    }),
  });

  assert.equal(validation.response.status, 200);
  assert.equal(validation.body.ok, true);
  assert.equal(validation.body.verificationOnly, true);
  assert.equal(validation.body.diagnostics.readiness, "pilot_ready");
  assert.equal(validation.body.diagnostics.coverage.latency, true);
  assert.equal(validation.body.diagnostics.coverage.providerHealth, true);

  const unsupportedValidation = await request("/api/events/validate", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
    },
    body: JSON.stringify({
      type: "generation.completed",
      generationId: "gen_plain_validate",
      providerId: "fal",
      modelId: "flux-2-pro",
    }),
  });
  assert.equal(unsupportedValidation.response.status, 415);
  assert.equal(unsupportedValidation.body.code, "unsupported_media_type");
  assert.deepEqual(unsupportedValidation.body.accepts, ["application/json"]);

  const oversizedValidationBody = JSON.stringify({
    type: "provider.health",
    providerId: "fal",
    ignoredLargeField: "x".repeat(263000),
  });
  const oversizedValidation = await request("/api/events/validate", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: oversizedValidationBody,
  });
  assert.equal(oversizedValidation.response.status, 413);
  assert.equal(oversizedValidation.body.code, "payload_too_large");
  assert.equal(oversizedValidation.body.maxBodyBytes, 262144);

  const pilotEvents = [
    {
      type: "generation.completed",
      generationId: "gen_http_report_ok",
      providerId: "fal",
      modelId: "flux-2-pro",
      status: "succeeded",
      occurredAt: new Date(now - 180000).toISOString(),
      durationMs: 1200,
      cost: 0.04,
    },
    {
      type: "generation.failed",
      generationId: "gen_http_report_failed",
      providerId: "fal",
      modelId: "flux-2-pro",
      status: "failed",
      occurredAt: new Date(now - 120000).toISOString(),
      durationMs: 3000,
      cost: 0.02,
      retryCount: 2,
    },
    {
      eventId: "provider.health:fal:pilot-workflow",
      type: "provider.health",
      providerId: "fal",
      occurredAt: new Date(now - 60000).toISOString(),
    },
    {
      type: "generation.completed",
      generationId: "gen_http_report_noise",
      providerId: "openai",
      modelId: "gpt-image-2",
      status: "succeeded",
      occurredAt: new Date(now).toISOString(),
      durationMs: 900,
      cost: 0.08,
    },
  ];

  const ingest = await request(
    "/api/events",
    withIngestAuth({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        events: pilotEvents,
      }),
    }),
  );

  assert.equal(ingest.response.status, 200);
  assert.equal(ingest.body.ok, true);
  assert.equal(ingest.body.storedEvents, 4);
  assert.equal(ingest.body.diagnostics.readiness, "pilot_ready");
  assert.equal(ingest.body.receipt.type, "signalops.source_event_receipt");
  assert.equal(ingest.body.receipt.workspaceSlug, "demo");
  assert.equal(ingest.body.receipt.acceptedEventIds.length, 4);
  assert.deepEqual(ingest.body.duplicateEventIds, []);
  assert.deepEqual(ingest.body.receipt.duplicateEventIds, []);
  assert.equal(ingest.body.receipt.storage.durable, false);
  assert.equal(ingest.body.receipt.proof.demoDataIncluded, false);
  assert.equal(ingest.body.receipt.proof.durableWrite, false);
  assert.equal(ingest.body.receipt.proof.existingEventCandidate, true);
  assert.match(ingest.body.receipt.proof.exactSourceReportPath, /eventId=/);
  assert.match(ingest.body.receipt.nextActions.join(" "), /durable proof/);

  const unsupportedIngest = await request(
    "/api/events",
    withIngestAuth({
      method: "POST",
      headers: {
        "content-type": "text/plain",
      },
      body: JSON.stringify({
        type: "generation.completed",
        generationId: "gen_plain_ingest",
        providerId: "fal",
        modelId: "flux-2-pro",
      }),
    }),
  );
  assert.equal(unsupportedIngest.response.status, 415);
  assert.equal(unsupportedIngest.body.code, "unsupported_media_type");
  assert.deepEqual(unsupportedIngest.body.accepts, ["application/json"]);

  const oversizedIngest = await request(
    "/api/events",
    withIngestAuth({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: oversizedValidationBody,
    }),
  );
  assert.equal(oversizedIngest.response.status, 413);
  assert.equal(oversizedIngest.body.code, "payload_too_large");
  assert.equal(oversizedIngest.body.maxBodyBytes, 262144);

  const postIngestHealth = await request("/api/health");
  assert.equal(postIngestHealth.response.status, 200);
  assert.equal(postIngestHealth.body.firstSourceEvent.ready, false);
  assert.equal(postIngestHealth.body.firstSourceEvent.durable, false);
  assert.equal(postIngestHealth.body.nextExternalSteps.includes("send_first_real_source_event"), true);

  const lockedSnapshot = await request("/api/snapshot?range=24h");
  assert.equal(lockedSnapshot.response.status, 200);
  assert.equal(lockedSnapshot.body.sourceOverlay.demoDataIncluded, true);
  assert.equal(lockedSnapshot.body.sourceOverlay.sourceEventsIncluded, false);
  assert.equal(lockedSnapshot.body.sourceOverlay.sourceEventCount, 0);

  const sourceTokenSnapshot = await request("/api/snapshot?range=24h", withIngestAuth());
  assert.equal(sourceTokenSnapshot.response.status, 200);
  assert.equal(sourceTokenSnapshot.body.sourceOverlay.demoDataIncluded, true);
  assert.equal(sourceTokenSnapshot.body.sourceOverlay.sourceEventsIncluded, false);

  const snapshot = await request("/api/snapshot?range=24h", withOperatorAuth());
  assert.equal(snapshot.response.status, 200);
  assert.equal(snapshot.body.sourceOverlay.demoDataIncluded, true);
  assert.equal(snapshot.body.sourceOverlay.sourceEventsIncluded, true);
  assert.equal(snapshot.body.sourceOverlay.durableSourceStorage, false);
  assert.equal(snapshot.body.sourceOverlay.sourceEventCount, 4);
  assert.equal(snapshot.body.sourceOverlay.sourceGenerationCount, 3);
  assert.deepEqual(snapshot.body.sourceOverlay.sourceProviders, ["fal", "openai"]);
  assert.deepEqual(snapshot.body.sourceOverlay.sourceModels, ["flux-2-pro", "gpt-image-2"]);
  assert.equal(snapshot.body.sourceOverlay.sourceOnlyReportPath, "/source-report?range=24h");
  const overlayRows = snapshot.body.generations.filter((generation) =>
    ["gen_http_report_ok", "gen_http_report_failed", "gen_http_report_noise"].includes(generation.id),
  );
  assert.equal(overlayRows.length, 3);
  assert.ok(overlayRows.every((generation) => generation.source === "api"));

  const lockedSourceReport = await request("/api/source-report");
  assert.equal(lockedSourceReport.response.status, 401);
  assert.equal(lockedSourceReport.body.code, "cockpit_auth_required");

  const sourceTokenReport = await request("/api/source-report", withIngestAuth());
  assert.equal(sourceTokenReport.response.status, 401);
  assert.equal(sourceTokenReport.body.code, "cockpit_auth_required");

  const sourceReport = await request("/api/source-report", withOperatorAuth());
  assert.equal(sourceReport.response.status, 200);
  assert.equal(sourceReport.body.ok, true);
  assert.equal(sourceReport.body.report.sourceOnly, true);
  assert.equal(sourceReport.body.report.demoDataIncluded, false);
  assert.equal(sourceReport.body.report.totalEvents, 4);
  assert.equal(sourceReport.body.report.providers[0].providerId, "fal");
  assert.equal(sourceReport.body.report.providers[0].status, "degraded");
  assert.equal(sourceReport.body.report.pilotEvidence.level, "pilot_ready");
  assert.equal(sourceReport.body.report.pilotEvidence.readyForOperatorReview, true);
  assert.match(sourceReport.body.report.pilotEvidence.recommendedScope.join(" "), /first pilot workflow/);
  assert.equal(sourceReport.body.report.operatorBrief.decision, "pilot_review_ready");
  assert.match(sourceReport.body.report.operatorBrief.headline, /source evidence is ready enough/);
  assert.match(sourceReport.body.report.operatorBrief.proofChecklist.join(" "), /demoDataIncluded=false/);
  assert.match(sourceReport.body.report.operatorBrief.nonGoals.join(" "), /do not claim production readiness/);
  assert.match(sourceReport.body.report.risks.join(" "), /degraded providers/);

  const filteredSourceReport = await request(
    "/api/source-report?limit=2&range=24h&providerId=fal&modelId=flux-2-pro",
    withOperatorAuth(),
  );
  assert.equal(filteredSourceReport.response.status, 200);
  assert.equal(filteredSourceReport.body.filters.range, "24h");
  assert.equal(filteredSourceReport.body.filters.providerId, "fal");
  assert.equal(filteredSourceReport.body.filters.modelId, "flux-2-pro");
  assert.equal(filteredSourceReport.body.report.totalEvents, 2);
  assert.equal(filteredSourceReport.body.report.providerHealthEvents, 0);
  assert.equal(filteredSourceReport.body.report.providers[0].providerId, "fal");

  const receiptSourceReport = await request(
    ingest.body.receipt.proof.exactSourceReportPath.replace("/source-report", "/api/source-report"),
    withOperatorAuth(),
  );
  assert.equal(receiptSourceReport.response.status, 200);
  assert.equal(receiptSourceReport.body.filters.eventId, ingest.body.receipt.storedEventIds[0]);
  assert.equal(receiptSourceReport.body.report.totalEvents, 1);
  assert.equal(receiptSourceReport.body.report.demoDataIncluded, false);

  const duplicateIngest = await request(
    "/api/events",
    withIngestAuth({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ events: pilotEvents }),
    }),
  );
  assert.equal(duplicateIngest.response.status, 200);
  assert.equal(duplicateIngest.body.storedEvents, 0);
  assert.equal(duplicateIngest.body.duplicateEvents, 4);
  assert.deepEqual(duplicateIngest.body.receipt.duplicateEventIds, ingest.body.receipt.storedEventIds);
  assert.equal(duplicateIngest.body.receipt.proof.durableWrite, false);
  assert.equal(duplicateIngest.body.receipt.proof.existingEventCandidate, true);
  assert.match(duplicateIngest.body.receipt.proof.exactSourceReportPath, /eventId=/);

  const duplicateReceiptReport = await request(
    duplicateIngest.body.receipt.proof.exactSourceReportPath.replace("/source-report", "/api/source-report"),
    withOperatorAuth(),
  );
  assert.equal(duplicateReceiptReport.response.status, 200);
  assert.equal(duplicateReceiptReport.body.filters.eventId, duplicateIngest.body.receipt.duplicateEventIds[0]);
  assert.equal(duplicateReceiptReport.body.report.totalEvents, 1);
  assert.equal(duplicateReceiptReport.body.report.demoDataIncluded, false);

  const sourceReportMarkdown = await requestText(
    "/api/source-report?range=24h&providerId=fal&modelId=flux-2-pro&format=markdown",
    withOperatorAuth(),
  );
  assert.equal(sourceReportMarkdown.response.status, 200);
  assert.match(sourceReportMarkdown.response.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(sourceReportMarkdown.body, /# SignalOps Source Report: demo/);
  assert.match(sourceReportMarkdown.body, /Demo data included: false/);
  assert.match(sourceReportMarkdown.body, /Filters: range=24h, provider=fal, model=flux-2-pro/);
  assert.match(sourceReportMarkdown.body, /## Pilot Evidence/);
  assert.match(sourceReportMarkdown.body, /## Operator Brief/);
  assert.match(sourceReportMarkdown.body, /Decision: pilot_review_ready/);
  assert.match(sourceReportMarkdown.body, /Level: pilot_ready/);
  assert.match(sourceReportMarkdown.body, /degraded providers: fal/);

  const sourceReportCsv = await requestText(
    "/api/source-report?range=24h&providerId=fal&modelId=flux-2-pro&format=csv",
    withOperatorAuth(),
  );
  assert.equal(sourceReportCsv.response.status, 200);
  assert.match(sourceReportCsv.response.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(sourceReportCsv.body, /^row_type,provider_id,model_id,status,event_count,/);
  assert.match(sourceReportCsv.body, /provider,fal,,degraded,2,2/);

  const spam = await request("/api/pilot-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Spam Bot",
      email: "spam@example.com",
      generationVolume: "50k images/month",
      providers: "fal, OpenAI",
      primaryPain: "Retries and failures",
      urgency: "this_month",
      desiredOutcome: "Test spam handling",
      useCase: "We run image generation jobs and need latency, retry, and cost visibility.",
      website: "https://spam.example",
    }),
  });
  assert.equal(spam.response.status, 422);
  assert.equal(spam.body.ok, false);
  assert.equal(spam.body.code, "spam_detected");

  const unsupportedPilotSubmit = await request("/api/pilot-requests", {
    method: "POST",
    headers: {
      "content-type": "text/plain",
    },
    body: "name=Maya Chen",
  });
  assert.equal(unsupportedPilotSubmit.response.status, 415);
  assert.equal(unsupportedPilotSubmit.body.code, "unsupported_media_type");
  assert.deepEqual(unsupportedPilotSubmit.body.accepts, [
    "application/json",
    "application/x-www-form-urlencoded",
    "multipart/form-data",
  ]);

  const oversizedPilotSubmit = await request("/api/pilot-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Maya Chen",
      email: "maya@example.com",
      generationVolume: "50k images/month",
      providers: "fal, OpenAI",
      primaryPain: "x".repeat(33000),
      urgency: "this_month",
      desiredOutcome: "Test the body-size guard.",
      useCase: "We run image generation jobs and need latency, retry, and cost visibility.",
    }),
  });
  assert.equal(oversizedPilotSubmit.response.status, 413);
  assert.equal(oversizedPilotSubmit.body.code, "payload_too_large");
  assert.equal(oversizedPilotSubmit.body.maxBodyBytes, 32768);

  const submit = await request("/api/pilot-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Maya Chen",
      email: "maya@example.com",
      company: "Image Studio",
      productUrl: "https://example.com",
      generationVolume: "50k images/month",
      providers: "fal, OpenAI",
      primaryPain: "Provider latency spikes and retry storms",
      urgency: "this_month",
      desiredOutcome: "Know which provider/model is causing user-visible failures before support tickets arrive.",
      useCase: "We run image generation jobs across providers and need latency, retry, and cost visibility.",
    }),
  });

  assert.equal(submit.response.status, 202);
  assert.equal(submit.body.ok, true);
  assert.equal(submit.body.qualification.tier, "strong_fit");
  assert.equal(submit.body.deliveries[0].target, "ephemeral_storage");
  assert.equal(submit.body.deliveries[0].ok, true);
  assert.match(submit.body.deliveries[0].deliveryId, /^del_ephemeral_storage_/);
  assert.equal(Number.isNaN(new Date(submit.body.deliveries[0].attemptedAt).getTime()), false);

  const list = await request("/api/pilot-requests?limit=5", withOperatorAuth());
  assert.equal(list.response.status, 200);
  assert.equal(list.body.count, 1);
  assert.equal(list.body.summary.total, 1);
  assert.equal(list.body.summary.openCount, 1);
  assert.equal(list.body.summary.unscheduledOpenCount, 1);
  assert.equal(list.body.pilotRequests[0].id, submit.body.pilotRequestId);
  assert.equal(list.body.pilotRequests[0].activity[0].type, "submitted");

  const sourceTokenList = await request("/api/pilot-requests?limit=5", withIngestAuth());
  assert.equal(sourceTokenList.response.status, 401);
  assert.equal(sourceTokenList.body.code, "unauthorized");

  const sourceTokenCsv = await requestText("/api/pilot-requests?format=csv", withIngestAuth());
  assert.equal(sourceTokenCsv.response.status, 401);
  assert.match(sourceTokenCsv.body, /unauthorized/);

  const unscheduledList = await request("/api/pilot-requests?followUp=unscheduled", withOperatorAuth());
  assert.equal(unscheduledList.response.status, 200);
  assert.equal(unscheduledList.body.filters.followUp, "unscheduled");
  assert.equal(unscheduledList.body.count, 1);
  assert.equal(unscheduledList.body.pilotRequests[0].id, submit.body.pilotRequestId);

  const sourceTokenUpdate = await request(
    "/api/pilot-requests",
    withIngestAuth({
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: submit.body.pilotRequestId,
        status: "contacted",
        operatorNote: "source token must not mutate operator lifecycle",
      }),
    }),
  );
  assert.equal(sourceTokenUpdate.response.status, 401);
  assert.equal(sourceTokenUpdate.body.code, "unauthorized");

  const unsupportedOperatorUpdate = await request("/api/pilot-requests", {
    ...withOperatorAuth(),
    method: "PATCH",
    headers: {
      "content-type": "text/plain",
      authorization: "Bearer sop_operator_workflow",
    },
    body: JSON.stringify({
      id: submit.body.pilotRequestId,
      status: "contacted",
    }),
  });
  assert.equal(unsupportedOperatorUpdate.response.status, 415);
  assert.equal(unsupportedOperatorUpdate.body.code, "unsupported_media_type");
  assert.deepEqual(unsupportedOperatorUpdate.body.accepts, ["application/json"]);

  const update = await request("/api/pilot-requests", {
    ...withOperatorAuth(),
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sop_operator_workflow",
    },
    body: JSON.stringify({
      id: submit.body.pilotRequestId,
      status: "contacted",
      operatorNote: "Asked for source event sample and scoped setup call.",
      nextActionAt: "2026-06-30T10:00:00.000Z",
    }),
  });

  assert.equal(update.response.status, 200);
  assert.equal(update.body.ok, true);
  assert.equal(update.body.pilotRequest.lifecycle.status, "contacted");
  assert.equal(update.body.pilotRequest.lifecycle.operatorNote, "Asked for source event sample and scoped setup call.");
  assert.equal(update.body.pilotRequest.activity.at(-1).type, "lifecycle_updated");
  assert.match(update.body.pilotRequest.activity.at(-1).summary, /status new -> contacted/);

  const updatedList = await request("/api/pilot-requests?limit=5", withOperatorAuth());
  assert.equal(updatedList.response.status, 200);
  assert.equal(updatedList.body.pilotRequests[0].lifecycle.status, "contacted");
  assert.equal(updatedList.body.pilotRequests[0].activity.length, 2);
  assert.equal(updatedList.body.summary.byStatus.contacted, 1);
  assert.equal(updatedList.body.summary.unscheduledOpenCount, 0);

  const noLongerUnscheduled = await request("/api/pilot-requests?followUp=unscheduled", withOperatorAuth());
  assert.equal(noLongerUnscheduled.response.status, 200);
  assert.equal(noLongerUnscheduled.body.count, 0);

  const filteredList = await request("/api/pilot-requests?status=contacted&tier=strong_fit", withOperatorAuth());
  assert.equal(filteredList.response.status, 200);
  assert.equal(filteredList.body.filters.status, "contacted");
  assert.equal(filteredList.body.filters.tier, "strong_fit");
  assert.equal(filteredList.body.count, 1);
  assert.equal(filteredList.body.pilotRequests[0].id, submit.body.pilotRequestId);

  const csv = await requestText("/api/pilot-requests?status=contacted&tier=strong_fit&format=csv", withOperatorAuth());
  assert.equal(csv.response.status, 200);
  assert.match(csv.response.headers.get("content-type") ?? "", /text\/csv/);
  assert.match(csv.response.headers.get("content-disposition") ?? "", /signalops-pilot-requests\.csv/);
  assert.match(csv.body, /^id,created_at,status,qualification_tier,name,email,/);
  assert.match(csv.body, new RegExp(submit.body.pilotRequestId));
  assert.match(csv.body, /contacted/);

  const sourceTokenHandoff = await request(`/api/pilot-requests/${submit.body.pilotRequestId}/handoff`, withIngestAuth());
  assert.equal(sourceTokenHandoff.response.status, 401);
  assert.equal(sourceTokenHandoff.body.code, "unauthorized");

  const sourceTokenHandoffMarkdown = await requestText(
    `/api/pilot-requests/${submit.body.pilotRequestId}/handoff?format=markdown`,
    withIngestAuth(),
  );
  assert.equal(sourceTokenHandoffMarkdown.response.status, 401);
  assert.match(sourceTokenHandoffMarkdown.body, /unauthorized/);

  const handoff = await request(`/api/pilot-requests/${submit.body.pilotRequestId}/handoff`, withOperatorAuth());
  assert.equal(handoff.response.status, 200);
  assert.equal(handoff.body.ok, true);
  assert.equal(handoff.body.handoff.pilotRequestId, submit.body.pilotRequestId);
  assert.equal(handoff.body.handoff.company, "Image Studio");
  assert.equal(handoff.body.handoff.emailDraft.subject, "SignalOps pilot for Image Studio");
  assert.match(handoff.body.handoff.emailDraft.body, /Source kit:/);
  assert.match(handoff.body.handoff.sourceIntegration.validateCurl, /\/api\/events\/validate/);
  assert.match(handoff.body.handoff.sourceIntegration.ingestCurl, /authorization: Bearer \$SIGNALOPS_INGEST_TOKEN/);
  assert.match(handoff.body.handoff.sourceIntegration.curl, /authorization: Bearer \$SIGNALOPS_INGEST_TOKEN/);
  assert.match(handoff.body.handoff.sourceIntegration.nodeSnippet, /providerHealth/);
  assert.match(handoff.body.handoff.sourceIntegration.nodeSnippet, /costRecorded/);
  assert.match(
    handoff.body.handoff.acceptanceChecklist.firstEventProof.join("\n"),
    /demoDataIncluded=false/,
  );
  assert.match(
    handoff.body.handoff.acceptanceChecklist.nonGoals.join("\n"),
    /validation-only requests/,
  );
  assert.match(
    handoff.body.handoff.sourceIntegration.preflightCommands[0],
    /^SIGNALOPS_BASE_URL=http:\/\/(localhost|127\.0\.0\.1):3037 pnpm verify:pilot-preflight -- --allow-storage-gate$/,
  );
  assert.match(
    handoff.body.handoff.sourceIntegration.preflightCommands[1],
    /^SIGNALOPS_BASE_URL=http:\/\/(localhost|127\.0\.0\.1):3037 SIGNALOPS_INGEST_TOKEN=\.\.\. SIGNALOPS_OPERATOR_TOKEN=\.\.\. pnpm verify:pilot-preflight -- --require-pilot-ready$/,
  );
  assert.ok(handoff.body.handoff.recommendedPilot.successSignals.length >= 3);

  const handoffMarkdown = await requestText(
    `/api/pilot-requests/${submit.body.pilotRequestId}/handoff?format=markdown`,
    withOperatorAuth(),
  );
  assert.equal(handoffMarkdown.response.status, 200);
  assert.match(handoffMarkdown.response.headers.get("content-type") ?? "", /text\/markdown/);
  assert.match(handoffMarkdown.body, /# SignalOps Pilot Handoff: Image Studio/);
  assert.match(handoffMarkdown.body, /## Source Integration/);
  assert.match(handoffMarkdown.body, /## Acceptance Checklist/);
  assert.match(handoffMarkdown.body, /First event proof:/);
  assert.match(handoffMarkdown.body, /Do not count validation-only requests as real source traffic/);
  assert.match(handoffMarkdown.body, /Validate without storing/);
  assert.match(handoffMarkdown.body, /SDK snippet/);
  assert.match(handoffMarkdown.body, /verify:pilot-preflight/);

  console.log("ok: SignalOps pilot workflow");
} finally {
  await stopServer();
}

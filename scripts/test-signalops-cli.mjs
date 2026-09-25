import assert from "node:assert/strict";
import { runSignalOpsCli } from "../packages/signalops-node/dist/cli.js";

const originalFetch = globalThis.fetch;
let ingestFailureCode = "ingest_storage_not_configured";
const diagnostics = {
  readiness: "partial",
  coverage: {
    generationLifecycle: {
      started: false,
      completed: true,
      failed: false,
      retrying: false,
    },
    providerHealth: false,
    latency: true,
    cost: true,
    retries: false,
    providers: 1,
    models: 1,
  },
  gaps: ["send provider.health events when provider state changes"],
  nextActions: ["send provider.health events when provider state changes"],
};

function createIo() {
  const logs = [];
  const errors = [];
  return {
    logs,
    errors,
    io: {
      log: (message) => logs.push(String(message)),
      error: (message) => errors.push(String(message)),
    },
  };
}

globalThis.fetch = async (url, init = {}) => {
  const body = init.body ? JSON.parse(String(init.body)) : null;
  const parsedUrl = new URL(String(url));

  if (String(url).endsWith("/api/source-kit")) {
    return Response.json({
      ok: true,
      kit: {
        product: "SignalOps",
        packageName: "@signalops/node",
        compatibility: {
          ingestResponseIncludesReceipt: true,
          ingestResponseIncludesDuplicateEventIds: true,
        },
        idempotency: {
          eventIdMaxLength: 160,
          helper: { name: "createSignalOpsEventId" },
        },
        storageStrategy: {
          mode: "reuse_existing_resource",
          newResourcesAllowed: false,
          discoveryCommand:
            "CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema",
        },
        pilotIntakePolicy: {
          maxBodyBytes: 32768,
          maxBodyKb: 32,
          deliveryTimeoutMs: 5000,
          acceptedContentTypes: ["application/json", "application/x-www-form-urlencoded", "multipart/form-data"],
        },
        operatorEnv: ["SIGNALOPS_OPERATOR_TOKEN"],
        requiredServerEnv: ["SIGNALOPS_BASE_URL", "SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_WORKSPACE_SLUG"],
        verification: {
          readinessGates: [
            "durable_storage",
            "ingest_auth",
            "workspace_identity",
            "privacy_mode",
            "operator_access",
            "pilot_delivery",
            "first_source_event",
          ],
          commands: {
            strictPreflight:
              "SIGNALOPS_BASE_URL=https://signalops.cc SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready",
            sourceReportByEvent:
              'node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --event-id "generation.completed:gen_prod_001"',
            sourceReportJson:
              'node packages/signalops-node/dist/cli.js source-report --endpoint https://signalops.cc --operator-token "$SIGNALOPS_OPERATOR_TOKEN" --range 24h',
          },
        },
        ingestPolicy: {
          maxBatchEvents: 100,
          maxBodyBytes: 262144,
          maxBodyKb: 256,
          privacyMode: "redact",
        },
      },
    });
  }

  if (parsedUrl.pathname === "/api/source-report") {
    assert.equal(init.headers.authorization, "Bearer sop_operator");
    assert.equal(parsedUrl.searchParams.get("range") ?? "all", "24h");
    if (parsedUrl.searchParams.has("eventId")) {
      assert.equal(parsedUrl.searchParams.get("eventId"), "generation.completed:gen_cli");
    }
    assert.equal(parsedUrl.searchParams.get("providerId"), "fal");
    assert.equal(parsedUrl.searchParams.get("modelId"), "flux-2-pro");
    assert.equal(parsedUrl.searchParams.get("limit"), "25");

    if (parsedUrl.searchParams.get("format") === "markdown") {
      return new Response("# SignalOps Source Report: demo\n\nFilters: range=24h, provider=fal, model=flux-2-pro", {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    return Response.json({
      ok: true,
      limit: 25,
      filters: {
        range: "24h",
        providerId: "fal",
        modelId: "flux-2-pro",
      },
      report: {
        sourceOnly: true,
        demoDataIncluded: false,
        totalEvents: 2,
      },
      requestId: "req_report",
    });
  }

  if (String(url).endsWith("/api/events/validate")) {
    if (body.generationId === "gen_cli_verify") {
      assert.equal(body.eventId, "generation.completed:gen_cli_verify:explicit");
    }
    return Response.json({
      ok: true,
      verificationOnly: true,
      ingestPolicy: {
        maxBatchEvents: 100,
        maxBodyBytes: 262144,
        maxBodyKb: 256,
        privacyMode: "redact",
      },
      validEvents: Array.isArray(body.events) ? body.events.length : 1,
      rejectedEvents: 0,
      eventTypes: ["generation.completed"],
      providerIds: [body.providerId ?? body.events?.[0]?.providerId ?? "verify-provider"],
      modelIds: [body.modelId ?? body.events?.[0]?.modelId ?? "verify-model"],
      privacyMode: "redact",
      diagnostics,
      storedEvents: 0,
      rejected: [],
      requestId: "req_validate",
    });
  }

  if (String(url).endsWith("/api/events")) {
    assert.equal(init.headers.authorization, "Bearer sop_test");
    if (body.generationId === "gen_cli_verify") {
      assert.equal(body.eventId, "generation.completed:gen_cli_verify:explicit");
    }
    return Response.json(
      { ok: false, code: ingestFailureCode, requestId: "req_storage" },
      { status: 503 },
    );
  }

  return Response.json({ ok: false, code: "not_found" }, { status: 404 });
};

try {
  const sourceKitIo = createIo();
  assert.equal(await runSignalOpsCli(["source-kit", "--endpoint", "https://signalops.cc"], {}, sourceKitIo.io), 0);
  const sourceKit = JSON.parse(sourceKitIo.logs[0]);
  assert.equal(sourceKit.kit.packageName, "@signalops/node");
  assert.deepEqual(sourceKit.kit.operatorEnv, ["SIGNALOPS_OPERATOR_TOKEN"]);
  assert.equal(sourceKit.kit.compatibility.ingestResponseIncludesReceipt, true);
  assert.equal(sourceKit.kit.compatibility.ingestResponseIncludesDuplicateEventIds, true);
  assert.equal(sourceKit.kit.idempotency.helper.name, "createSignalOpsEventId");
  assert.equal(sourceKit.kit.storageStrategy.mode, "reuse_existing_resource");
  assert.equal(sourceKit.kit.storageStrategy.newResourcesAllowed, false);
  assert.match(sourceKit.kit.storageStrategy.discoveryCommand, /--existing-only/);
  assert.equal(sourceKit.kit.pilotIntakePolicy.maxBodyBytes, 32768);
  assert.equal(sourceKit.kit.pilotIntakePolicy.deliveryTimeoutMs, 5000);
  assert.ok(sourceKit.kit.requiredServerEnv.includes("SIGNALOPS_WORKSPACE_SLUG"));
  assert.match(sourceKit.kit.verification.commands.sourceReportByEvent, /--event-id/);
  assert.ok(sourceKit.kit.verification.readinessGates.includes("workspace_identity"));
  assert.ok(sourceKit.kit.verification.readinessGates.includes("privacy_mode"));
  assert.ok(sourceKit.kit.verification.readinessGates.includes("first_source_event"));
  assert.match(sourceKit.kit.verification.commands.strictPreflight, /--require-pilot-ready/);

  const validationIo = createIo();
  assert.equal(
    await runSignalOpsCli(
      ["validate-events", "--endpoint", "https://signalops.cc"],
      {
        SIGNALOPS_VALIDATE_EVENTS_JSON:
          '{"type":"generation.completed","generationId":"gen_cli","providerId":"fal","modelId":"flux-2-pro"}',
      },
      validationIo.io,
    ),
    0,
  );
  const validation = JSON.parse(validationIo.logs[0]);
  assert.equal(validation.validEvents, 1);
  assert.equal(validation.ingestPolicy.maxBatchEvents, 100);
  assert.equal(validation.diagnostics.readiness, "partial");

  const reportIo = createIo();
  assert.equal(
    await runSignalOpsCli(
      [
        "source-report",
        "--endpoint",
        "https://signalops.cc",
        "--range",
        "24h",
        "--provider-id",
        "fal",
        "--event-id",
        "generation.completed:gen_cli",
        "--model-id",
        "flux-2-pro",
        "--limit",
        "25",
        "--operator-token",
        "sop_operator",
      ],
      {},
      reportIo.io,
    ),
    0,
  );
  const report = JSON.parse(reportIo.logs[0]);
  assert.equal(report.filters.range, "24h");
  assert.equal(report.report.sourceOnly, true);

  const reportMarkdownIo = createIo();
  assert.equal(
    await runSignalOpsCli(
      [
        "source-report",
        "--endpoint",
        "https://signalops.cc",
        "--range",
        "24h",
        "--provider-id",
        "fal",
        "--model-id",
        "flux-2-pro",
        "--limit",
        "25",
        "--format",
        "markdown",
      ],
      { SIGNALOPS_OPERATOR_TOKEN: "sop_operator" },
      reportMarkdownIo.io,
    ),
    0,
  );
  assert.match(reportMarkdownIo.logs[0], /^# SignalOps Source Report: demo/);

  const smokeIo = createIo();
  assert.equal(
    await runSignalOpsCli(
      [
        "verify-source",
        "--endpoint",
        "https://signalops.cc",
        "--token",
        "sop_test",
        "--allow-storage-gate",
        "--generation",
        "gen_cli_verify",
        "--event-id",
        "generation.completed:gen_cli_verify:explicit",
      ],
      {},
      smokeIo.io,
    ),
    0,
  );
  const smoke = JSON.parse(smokeIo.logs[0]);
  assert.equal(smoke.mode, "storage_gate");
  assert.equal(smoke.ingest.code, "ingest_storage_not_configured");

  ingestFailureCode = "workspace_not_configured";
  const workspaceSmokeIo = createIo();
  assert.equal(
    await runSignalOpsCli(
      [
        "verify-source",
        "--endpoint",
        "https://signalops.cc",
        "--token",
        "sop_test",
        "--allow-storage-gate",
        "--generation",
        "gen_cli_workspace",
      ],
      {},
      workspaceSmokeIo.io,
    ),
    0,
  );
  const workspaceSmoke = JSON.parse(workspaceSmokeIo.logs[0]);
  assert.equal(workspaceSmoke.mode, "storage_gate");
  assert.equal(workspaceSmoke.ingest.code, "workspace_not_configured");

  console.log("ok: SignalOps CLI");
} finally {
  globalThis.fetch = originalFetch;
}

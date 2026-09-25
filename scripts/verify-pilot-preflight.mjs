#!/usr/bin/env node

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const args = new Set(rawArgs);
const baseUrlArg = rawArgs.find((arg) => arg.startsWith("--base-url="));
const baseUrl = (baseUrlArg?.slice("--base-url=".length) || process.env.SIGNALOPS_BASE_URL || "https://signalops.cc").replace(
  /\/$/,
  "",
);
const ingestTokenArg = rawArgs.find((arg) => arg.startsWith("--token="));
const operatorTokenArg = rawArgs.find((arg) => arg.startsWith("--operator-token="));
const ingestToken = ingestTokenArg?.slice("--token=".length) || process.env.SIGNALOPS_INGEST_TOKEN;
const operatorToken = operatorTokenArg?.slice("--operator-token=".length) || process.env.SIGNALOPS_OPERATOR_TOKEN;
const allowStorageGate = args.has("--allow-storage-gate");
const requirePilotReady = args.has("--require-pilot-ready");
const help = args.has("--help") || args.has("-h");

function usage() {
  return `Usage:
  pnpm verify:pilot-preflight
  SIGNALOPS_BASE_URL=https://signalops.cc pnpm verify:pilot-preflight -- --allow-storage-gate
  SIGNALOPS_BASE_URL=https://signalops.cc SIGNALOPS_INGEST_TOKEN=... SIGNALOPS_OPERATOR_TOKEN=... pnpm verify:pilot-preflight -- --require-pilot-ready

Options:
  --base-url=<url>          SignalOps base URL. Defaults to SIGNALOPS_BASE_URL or https://signalops.cc.
  --token=<token>           Source ingest token. Defaults to SIGNALOPS_INGEST_TOKEN.
  --operator-token=<token>  Operator API token. Defaults to SIGNALOPS_OPERATOR_TOKEN.
  --allow-storage-gate      Treat authenticated 503 setup gates as an expected pre-cutover state.
  --require-pilot-ready     Fail unless status/setup/ingest/report prove controlled pilot readiness.
`;
}

function createEventBatch(runId) {
  return {
    events: [
      {
        type: "generation.completed",
        eventId: `evt_preflight_completed_${runId}`,
        generationId: `gen_preflight_${runId}`,
        providerId: "fal",
        modelId: "flux-2-pro",
        status: "succeeded",
        source: "pilot-preflight",
        durationMs: 18420,
        cost: 0.052,
        retryCount: 1,
      },
      {
        type: "generation.retrying",
        eventId: `evt_preflight_retrying_${runId}`,
        generationId: `gen_preflight_retry_${runId}`,
        providerId: "fal",
        modelId: "flux-2-pro",
        status: "retrying",
        source: "pilot-preflight",
        retryCount: 2,
      },
      {
        type: "provider.health",
        eventId: `evt_preflight_health_${runId}`,
        providerId: "fal",
        status: "retrying",
        source: "pilot-preflight",
      },
      {
        type: "cost.recorded",
        eventId: `evt_preflight_cost_${runId}`,
        generationId: `gen_preflight_${runId}`,
        providerId: "fal",
        modelId: "flux-2-pro",
        source: "pilot-preflight",
        cost: 0.052,
      },
    ],
  };
}

async function request(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), init);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

async function getJson(path, headers) {
  return request(path, { headers });
}

async function postJson(path, body, token) {
  return request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function gate(id, ok, detail, required = true, evidence = {}) {
  return { id, ok, required, detail, evidence };
}

function pushHttpGate(gates, id, result, ok, detail, required = true) {
  gates.push(
    gate(id, ok, detail, required, {
      status: result.response.status,
      requestId: typeof result.body?.requestId === "string" ? result.body.requestId : undefined,
    }),
  );
}

async function main() {
  if (help) {
    console.log(usage());
    return;
  }

  const gates = [];
  const runId = Date.now().toString(36);
  const eventBatch = createEventBatch(runId);
  let mode = "validation_only";

  const [status, health, setup, sourceKit, openapi] = await Promise.all([
    getJson("/api/status"),
    getJson("/api/health"),
    getJson("/api/setup-plan"),
    getJson("/api/source-kit"),
    getJson("/api/openapi"),
  ]);

  pushHttpGate(gates, "status_contract", status, status.response.status === 200 && status.body.product === "SignalOps", "Status endpoint identifies SignalOps.");
  pushHttpGate(gates, "health_contract", health, health.response.status === 200 && health.body.service === "signalops", "Health endpoint exposes operator readiness.");
  pushHttpGate(
    gates,
    "setup_contract",
    setup,
    setup.response.status === 200 && setup.body.ok === true && Array.isArray(setup.body.plan?.gates),
    "Setup plan exposes machine-readable cutover gates.",
  );
  pushHttpGate(
    gates,
    "source_kit_contract",
    sourceKit,
      sourceKit.response.status === 200 &&
      sourceKit.body.ok === true &&
      sourceKit.body.kit?.compatibility?.ingestResponseIncludesReceipt === true &&
      sourceKit.body.kit?.compatibility?.ingestResponseIncludesDuplicateEventIds === true &&
      sourceKit.body.kit?.idempotency?.helper?.name === "createSignalOpsEventId" &&
      sourceKit.body.kit?.storageStrategy?.mode === "reuse_existing_resource" &&
      sourceKit.body.kit?.storageStrategy?.newResourcesAllowed === false &&
      /--existing-only/.test(sourceKit.body.kit?.storageStrategy?.discoveryCommand ?? "") &&
      sourceKit.body.kit?.verification?.readinessGates?.includes("workspace_identity") &&
      sourceKit.body.kit?.verification?.readinessGates?.includes("privacy_mode") &&
      /receipt\?\.proof/.test(sourceKit.body.kit?.snippets?.node ?? "") &&
      /createSignalOpsEventId/.test(sourceKit.body.kit?.snippets?.node ?? "") &&
      /providerHealth/.test(sourceKit.body.kit?.snippets?.node ?? "") &&
      /costRecorded/.test(sourceKit.body.kit?.snippets?.node ?? ""),
    "Source kit exposes SDK snippets for receipt proof, idempotency, provider health, and cost telemetry.",
  );
  pushHttpGate(
    gates,
    "openapi_contract",
    openapi,
    openapi.response.status === 200 && openapi.body.openapi === "3.1.0" && Boolean(openapi.body.paths?.["/api/events"]),
    "OpenAPI documents the source event API.",
  );

  gates.push(
    gate(
      "pilot_stage",
      requirePilotReady ? status.body.stage === "pilot_setup" : true,
      requirePilotReady
        ? `Live stage is ${status.body.stage}; expected pilot_setup.`
        : `Live stage is ${status.body.stage}; hosted_demo is acceptable for pre-cutover checks.`,
      requirePilotReady,
      { stage: status.body.stage },
    ),
  );

  const blockers = Array.isArray(setup.body.plan?.nextExternalSteps) ? setup.body.plan.nextExternalSteps : [];
  gates.push(
    gate(
      "setup_blockers",
      requirePilotReady ? blockers.length === 0 : true,
      blockers.length === 0 ? "Setup plan has no external blockers." : `Setup blockers: ${blockers.join(", ")}.`,
      requirePilotReady,
      { blockers },
    ),
  );

  const validation = await postJson("/api/events/validate", eventBatch);
  pushHttpGate(
    gates,
    "source_validation",
    validation,
    validation.response.status === 200 &&
      validation.body.ok === true &&
      validation.body.verificationOnly === true &&
      validation.body.storedEvents === 0 &&
      validation.body.diagnostics?.readiness === "pilot_ready" &&
      validation.body.diagnostics?.coverage?.providerHealth === true &&
      validation.body.diagnostics?.coverage?.cost === true,
    "Public validation accepts a representative pilot event batch without storing events.",
  );

  const unauthenticated = await postJson("/api/events", eventBatch);
  pushHttpGate(
    gates,
    "ingest_auth_guard",
    unauthenticated,
    unauthenticated.response.status === 401 && unauthenticated.body.code === "unauthorized",
    "Unauthenticated source ingest is rejected.",
  );

  let authenticated = null;
  if (ingestToken) {
    authenticated = await postJson("/api/events", eventBatch, ingestToken);
    const stored = authenticated.response.status === 200 && authenticated.body.ok === true && authenticated.body.storedEvents >= 1;
    const hasReceipt =
      stored &&
      authenticated.body.receipt?.type === "signalops.source_event_receipt" &&
      authenticated.body.receipt?.proof?.demoDataIncluded === false &&
      typeof authenticated.body.receipt?.proof?.exactSourceReportPath === "string";
    const setupGate =
      authenticated.response.status === 503 &&
      ["ingest_storage_not_configured", "workspace_not_configured"].includes(authenticated.body.code);
    if (stored) {
      mode = "authenticated_ingest";
    } else if (setupGate) {
      mode = "blocked_by_storage";
    }

    pushHttpGate(
      gates,
      "authenticated_ingest",
      authenticated,
      hasReceipt || (allowStorageGate && setupGate),
      hasReceipt
        ? "Authenticated ingest stores representative source events and returns a source-event receipt."
        : stored
          ? "Authenticated ingest stored events but did not return a usable source-event receipt."
        : setupGate
          ? `Authenticated ingest passed auth but is blocked by ${authenticated.body.code}.`
          : "Authenticated ingest did not store source events.",
      requirePilotReady || Boolean(ingestToken),
    );
  } else {
    gates.push(
      gate(
        "authenticated_ingest",
        !requirePilotReady,
        "SIGNALOPS_INGEST_TOKEN is not set, so authenticated ingest was skipped.",
        requirePilotReady,
      ),
    );
  }

  if (ingestToken) {
    const sourceTokenReport = await getJson("/api/source-report?limit=1", {
      authorization: `Bearer ${ingestToken}`,
    });
    const sourceTokenRejected =
      [401, 403].includes(sourceTokenReport.response.status) ||
      (sourceTokenReport.response.status === 503 && sourceTokenReport.body?.code === "operator_auth_not_configured");
    gates.push(
      gate(
        "ingest_token_not_operator",
        sourceTokenRejected,
        sourceTokenRejected
          ? "Source ingest token cannot read protected operator reports."
          : "Source ingest token unexpectedly read a protected operator report.",
        requirePilotReady || Boolean(ingestToken),
        {
          status: sourceTokenReport.response.status,
          code: typeof sourceTokenReport.body?.code === "string" ? sourceTokenReport.body.code : undefined,
          requestId: typeof sourceTokenReport.body?.requestId === "string" ? sourceTokenReport.body.requestId : undefined,
        },
      ),
    );
  } else {
    gates.push(
      gate(
        "ingest_token_not_operator",
        !requirePilotReady,
        "SIGNALOPS_INGEST_TOKEN is not set, so ingest-token/operator-boundary proof was skipped.",
        requirePilotReady,
      ),
    );
  }

  if (operatorToken && mode === "authenticated_ingest") {
    const exactSourceReportPath = authenticated?.body?.receipt?.proof?.exactSourceReportPath;
    const reportPath =
      typeof exactSourceReportPath === "string"
        ? exactSourceReportPath.replace(/^\/source-report/, "/api/source-report")
        : `/api/source-report?${new URLSearchParams({
            range: "24h",
            providerId: "fal",
            modelId: "flux-2-pro",
            limit: "25",
          }).toString()}`;
    const report = await getJson(reportPath, {
      authorization: `Bearer ${operatorToken}`,
    });
    const expectedEventId =
      authenticated?.body?.receipt?.storedEventIds?.[0] ?? authenticated?.body?.receipt?.duplicateEventIds?.[0];
    gates.push(gate(
      "operator_source_report",
      report.response.status === 200 &&
        report.body.ok === true &&
        report.body.report?.sourceOnly === true &&
        report.body.report?.demoDataIncluded === false &&
        (expectedEventId
          ? report.body.filters?.eventId === expectedEventId && report.body.report?.totalEvents === 1
          : report.body.report?.totalEvents >= 1),
      expectedEventId
        ? "Operator token can read the exact source-only report event from the ingest receipt."
        : "Operator token can read source-only report after ingest.",
      requirePilotReady,
      {
        reportPath,
        expectedEventId,
        status: report.response.status,
        requestId: typeof report.body?.requestId === "string" ? report.body.requestId : undefined,
      },
    ));
  } else {
    gates.push(
      gate(
        "operator_source_report",
        !requirePilotReady,
        operatorToken
          ? "Source report skipped because authenticated ingest did not store events."
          : "SIGNALOPS_OPERATOR_TOKEN is not set, so source report proof was skipped.",
        requirePilotReady,
      ),
    );
  }

  const requiredGates = gates.filter((item) => item.required);
  const ok = requiredGates.every((item) => item.ok);
  const summary = {
    ok,
    mode,
    baseUrl,
    requirePilotReady,
    gates,
    blockers: gates.filter((item) => item.required && !item.ok).map((item) => item.id),
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!ok) {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        ok: false,
        baseUrl,
        error: error instanceof Error ? error.message : "unknown pilot preflight failure",
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});

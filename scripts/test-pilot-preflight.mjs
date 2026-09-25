import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

let mode = "storage_gate";

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      resolve(raw ? JSON.parse(raw) : null);
    });
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/status") {
    jsonResponse(response, 200, {
      product: "SignalOps",
      stage: mode === "pilot_ready" ? "pilot_setup" : "hosted_demo",
      canValidateEvents: true,
      canAcceptSourceEvents: mode === "pilot_ready",
      canAcceptPilotRequests: mode === "pilot_ready",
      requirements: {
        durableStorage: mode === "pilot_ready",
        ingestAuth: true,
        operatorAccess: mode === "pilot_ready",
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    jsonResponse(response, 200, {
      ok: true,
      service: "signalops",
      eventValidation: { ready: true },
      eventIngest: { ready: mode === "pilot_ready" },
      pilotIntake: { ready: mode === "pilot_ready" },
      firstSourceEvent: {
        ready: mode === "pilot_ready",
        durable: mode === "pilot_ready",
        checked: mode === "pilot_ready",
        workspaceSlug: "demo",
      },
      nextExternalSteps: mode === "pilot_ready" ? [] : ["send_first_real_source_event"],
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/setup-plan") {
    jsonResponse(response, 200, {
      ok: true,
      plan: {
        gates: [],
        nextExternalSteps: mode === "pilot_ready" ? [] : ["durable_storage", "first_source_event"],
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/source-kit") {
    jsonResponse(response, 200, {
      ok: true,
      kit: {
        compatibility: {
          ingestResponseIncludesReceipt: true,
          ingestResponseIncludesDuplicateEventIds: true,
        },
        idempotency: {
          helper: { name: "createSignalOpsEventId" },
        },
        storageStrategy: {
          mode: "reuse_existing_resource",
          newResourcesAllowed: false,
          discoveryCommand:
            "CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema",
        },
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
        },
        snippets: {
          node: "console.log(sourceVerification.ingest.receipt?.proof); await signalops.providerHealth({ eventId: createSignalOpsEventId('provider.health', 'fal:status-page'), providerId: 'fal' }); await signalops.costRecorded({ eventId: createSignalOpsEventId('cost.recorded', 'gen_1:final'), providerId: 'fal', cost: 0.052 });",
        },
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/openapi") {
    jsonResponse(response, 200, {
      openapi: "3.1.0",
      paths: {
        "/api/events": {},
      },
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/events/validate") {
    const body = await readBody(request);
    assert.equal(body.events.length, 4);
    jsonResponse(response, 200, {
      ok: true,
      verificationOnly: true,
      storedEvents: 0,
      diagnostics: {
        readiness: "pilot_ready",
        coverage: {
          providerHealth: true,
          cost: true,
        },
      },
      requestId: "req_validate",
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/events") {
    const auth = request.headers.authorization;
    if (!auth) {
      jsonResponse(response, 401, { ok: false, code: "unauthorized", requestId: "req_unauth" });
      return;
    }
    assert.equal(auth, "Bearer sop_ingest_preflight");
    if (mode === "storage_gate") {
      jsonResponse(response, 503, {
        ok: false,
        code: "ingest_storage_not_configured",
        requestId: "req_storage_gate",
      });
      return;
    }
    const body = await readBody(request);
    jsonResponse(response, 200, {
      ok: true,
      accepted: 4,
      storedEvents: 4,
      duplicateEvents: 0,
      storedEventIds: [body.events[0].eventId],
      duplicateEventIds: [],
      receipt: {
        type: "signalops.source_event_receipt",
        requestId: "req_ingest",
        workspaceSlug: "demo",
        acceptedEventIds: [
          body.events[0].eventId,
          body.events[1].eventId,
          body.events[2].eventId,
          body.events[3].eventId,
        ],
        storedEventIds: [body.events[0].eventId],
        duplicateEvents: 0,
        duplicateEventIds: [],
        storage: {
          adapter: "cloudflare_d1",
          durable: true,
          ready: true,
        },
        proof: {
          demoDataIncluded: false,
          sourceOnlyReportPath: "/source-report?range=24h",
          exactSourceReportPath: `/source-report?range=all&eventId=${encodeURIComponent(body.events[0].eventId)}`,
          durableWrite: true,
          existingEventCandidate: true,
          firstSourceEventCandidate: true,
        },
        nextActions: ["open exact source report"],
      },
      requestId: "req_ingest",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/source-report") {
    if (request.headers.authorization === "Bearer sop_ingest_preflight") {
      jsonResponse(response, 401, { ok: false, code: "cockpit_auth_required", requestId: "req_ingest_report" });
      return;
    }

    assert.equal(request.headers.authorization, "Bearer sop_operator_preflight");
    assert.match(url.searchParams.get("eventId") ?? "", /^evt_preflight_completed_/);
    jsonResponse(response, 200, {
      ok: true,
      filters: {
        eventId: url.searchParams.get("eventId"),
      },
      report: {
        sourceOnly: true,
        demoDataIncluded: false,
        totalEvents: 1,
      },
      requestId: "req_report",
    });
    return;
  }

  jsonResponse(response, 404, { ok: false, code: "not_found", path: url.pathname });
});

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function runPreflight(args, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/verify-pilot-preflight.mjs", `--base-url=http://127.0.0.1:${port}`, ...args],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SIGNALOPS_INGEST_TOKEN: "sop_ingest_preflight",
          SIGNALOPS_OPERATOR_TOKEN: "sop_operator_preflight",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

try {
  const address = await listen(server);

  mode = "storage_gate";
  const storageGateRun = await runPreflight(["--allow-storage-gate"], address.port);
  assert.equal(storageGateRun.code, 0, storageGateRun.stderr);
  assert.equal(storageGateRun.stdout.includes("sop_ingest_preflight"), false);
  assert.equal(storageGateRun.stdout.includes("sop_operator_preflight"), false);
  const storageGateSummary = JSON.parse(storageGateRun.stdout);
  assert.equal(storageGateSummary.ok, true);
  assert.equal(storageGateSummary.mode, "blocked_by_storage");
  assert.deepEqual(storageGateSummary.blockers, []);
  assert.equal(storageGateSummary.gates.find((gate) => gate.id === "authenticated_ingest").ok, true);
  assert.equal(storageGateSummary.gates.find((gate) => gate.id === "ingest_token_not_operator").ok, true);
  assert.equal(storageGateSummary.gates.find((gate) => gate.id === "ingest_token_not_operator").evidence.status, 401);

  mode = "pilot_ready";
  const readyRun = await runPreflight(["--require-pilot-ready"], address.port);
  assert.equal(readyRun.code, 0, readyRun.stderr);
  assert.equal(readyRun.stdout.includes("sop_ingest_preflight"), false);
  assert.equal(readyRun.stdout.includes("sop_operator_preflight"), false);
  const readySummary = JSON.parse(readyRun.stdout);
  assert.equal(readySummary.ok, true);
  assert.equal(readySummary.mode, "authenticated_ingest");
  assert.deepEqual(readySummary.blockers, []);
  assert.equal(readySummary.gates.find((gate) => gate.id === "pilot_stage").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "ingest_token_not_operator").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "ingest_token_not_operator").evidence.status, 401);
  assert.equal(readySummary.gates.find((gate) => gate.id === "operator_source_report").ok, true);
  assert.match(
    readySummary.gates.find((gate) => gate.id === "operator_source_report").evidence.reportPath,
    /eventId=evt_preflight_completed_/,
  );

  console.log("ok: SignalOps pilot preflight");
} finally {
  await close(server);
}

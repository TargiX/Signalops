import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

let mode = "stale";

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function currentSourceKit() {
  return {
    ok: true,
    kit: {
      operatorEnv: ["SIGNALOPS_OPERATOR_TOKEN"],
      compatibility: {
        validationResultIncludesDiagnostics: true,
        ingestResponseIncludesReceipt: true,
      },
      endpoints: {
        setupPlan: "http://127.0.0.1/api/setup-plan",
        sourceReport: "http://127.0.0.1/api/source-report",
      },
      storageStrategy: {
        mode: "reuse_existing_resource",
        newResourcesAllowed: false,
        preferredTargets: ["cloudflare_d1_existing", "supabase_existing"],
        discoveryCommand: "CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema",
      },
      verification: {
        readinessGates: [
          "public_base_url",
          "durable_storage",
          "operator_access",
          "secret_boundaries",
          "workspace_identity",
          "privacy_mode",
          "pilot_delivery",
          "first_source_event",
        ],
      },
    },
  };
}

function currentSetupPlan() {
  return {
    ok: true,
    plan: {
      totalCount: 10,
      gates: [
        { id: "public_base_url", commands: ["vercel env add SIGNALOPS_BASE_URL production"] },
        { id: "durable_storage", commands: ["pnpm discover:cloudflare-d1 -- --existing-only --probe-schema"] },
        { id: "operator_access", commands: ["vercel env add SIGNALOPS_OPERATOR_TOKEN production"] },
        { id: "secret_boundaries", commands: ["pnpm verify:cutover --local-only --allow-blocked"] },
        { id: "workspace_identity", commands: ["vercel env add SIGNALOPS_WORKSPACE_SLUG production"] },
        { id: "privacy_mode", commands: ["printf 'redact' | vercel env add SIGNALOPS_EVENT_PRIVACY_MODE production"] },
        { id: "first_source_event", commands: ["pnpm verify:source-smoke --allow-storage-gate"] },
      ],
    },
  };
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (request.method === "GET" && url.pathname === "/api/status") {
    jsonResponse(response, 200, {
      product: "SignalOps",
      stage: mode === "ready" ? "pilot_setup" : "hosted_demo",
      canAcceptSourceEvents: mode === "ready",
      canAcceptPilotRequests: mode === "ready",
      canClaimProductionReady: false,
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    jsonResponse(response, 200, {
      ok: true,
      eventIngest: {
        ready: mode === "ready",
        durable: mode === "ready",
        policy: {
          privacyMode: "redact",
        },
      },
      workspace: {
        workspaceSlug: "signalops-pilot",
        configured: true,
        pilotReady: true,
        reason: "configured",
      },
      privacy: {
        ready: true,
        mode: "redact",
      },
      pilotIntake: {
        ready: mode === "ready",
      },
      firstSourceEvent: {
        ready: mode === "ready",
      },
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/source-kit") {
    jsonResponse(
      response,
      200,
      mode === "stale"
        ? {
            ok: true,
            kit: {
              compatibility: {
                validationResultIncludesIngestPolicy: true,
              },
              endpoints: {
                health: "http://127.0.0.1/api/health",
              },
            },
          }
        : currentSourceKit(),
    );
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/setup-plan") {
    jsonResponse(
      response,
      200,
      mode === "stale"
        ? {
            ok: true,
            plan: {
              totalCount: 5,
              gates: [
                {
                  id: "durable_storage",
                  commands: ["pnpm dlx wrangler@latest d1 create signalops-prod"],
                },
              ],
            },
          }
        : currentSetupPlan(),
    );
    return;
  }

  jsonResponse(response, 404, { ok: false, code: "not_found" });
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

function runReadiness(port, env = {}, args = ["--allow-blocked"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["scripts/verify-release-readiness.mjs", `--base-url=http://127.0.0.1:${port}`, ...args],
      {
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH,
          ...env,
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
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

try {
  const address = await listen(server);

  mode = "stale";
  const staleRun = await runReadiness(address.port);
  assert.equal(staleRun.code, 0, staleRun.stderr);
  const staleSummary = JSON.parse(staleRun.stdout);
  assert.equal(staleSummary.ok, false);
  assert.ok(staleSummary.blockers.includes("live_no_new_resource_runbook"));
  assert.ok(staleSummary.blockers.includes("live_latest_source_contract"));
  assert.ok(staleSummary.blockers.includes("live_pilot_intake"));
  assert.ok(staleSummary.blockers.includes("live_first_source_event"));
  assert.ok(staleSummary.blockers.includes("local_storage_target"));
  assert.ok(staleSummary.blockers.includes("local_operator_access"));
  assert.ok(staleSummary.blockers.includes("local_workspace_identity"));
  assert.ok(staleSummary.blockers.includes("local_ingest_token"));
  assert.equal(staleSummary.blockers.includes("local_privacy_mode"), false);

  mode = "ready";
  const readyEnv = {
    SIGNALOPS_DATABASE_TARGET: "cloudflare_d1",
    CLOUDFLARE_ACCOUNT_ID: "acct_signalops",
    CLOUDFLARE_D1_DATABASE_ID: "db_signalops",
    CLOUDFLARE_API_TOKEN: "cf_signalops",
    SIGNALOPS_INGEST_TOKEN: "sop_ingest",
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator",
    SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  };
  const readyRun = await runReadiness(address.port, readyEnv, []);
  assert.equal(readyRun.code, 0, readyRun.stderr);
  assert.equal(readyRun.stdout.includes("sop_ingest"), false);
  assert.equal(readyRun.stdout.includes("cf_signalops"), false);
  const readySummary = JSON.parse(readyRun.stdout);
  assert.equal(readySummary.ok, true);
  assert.deepEqual(readySummary.blockers, []);
  assert.equal(readySummary.gates.find((gate) => gate.id === "live_stage_honesty").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "live_no_new_resource_runbook").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "live_latest_source_contract").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "live_durable_source_ingest").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "live_pilot_intake").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "live_first_source_event").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "local_workspace_identity").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "local_privacy_mode").ok, true);
  assert.equal(readySummary.gates.find((gate) => gate.id === "local_secret_boundaries").ok, true);

  const reusedSecretRun = await runReadiness(address.port, {
    ...readyEnv,
    SIGNALOPS_OPERATOR_TOKEN: "sop_ingest",
  });
  assert.equal(reusedSecretRun.code, 0, reusedSecretRun.stderr);
  const reusedSecretSummary = JSON.parse(reusedSecretRun.stdout);
  assert.equal(reusedSecretSummary.ok, false);
  assert.ok(reusedSecretSummary.blockers.includes("local_secret_boundaries"));
  assert.match(
    reusedSecretSummary.gates.find((gate) => gate.id === "local_secret_boundaries").detail,
    /SIGNALOPS_INGEST_TOKEN\/SIGNALOPS_OPERATOR_TOKEN/,
  );

  const demoWorkspaceRun = await runReadiness(address.port, {
    ...readyEnv,
    SIGNALOPS_WORKSPACE_SLUG: "demo",
  });
  assert.equal(demoWorkspaceRun.code, 0, demoWorkspaceRun.stderr);
  const demoWorkspaceSummary = JSON.parse(demoWorkspaceRun.stdout);
  assert.equal(demoWorkspaceSummary.ok, false);
  assert.ok(demoWorkspaceSummary.blockers.includes("local_workspace_identity"));
  assert.match(
    demoWorkspaceSummary.gates.find((gate) => gate.id === "local_workspace_identity").detail,
    /demo/,
  );

  const rawPrivacyRun = await runReadiness(address.port, {
    ...readyEnv,
    SIGNALOPS_EVENT_PRIVACY_MODE: "raw",
  });
  assert.equal(rawPrivacyRun.code, 0, rawPrivacyRun.stderr);
  const rawPrivacySummary = JSON.parse(rawPrivacyRun.stdout);
  assert.equal(rawPrivacySummary.ok, false);
  assert.ok(rawPrivacySummary.blockers.includes("local_privacy_mode"));
  assert.match(
    rawPrivacySummary.gates.find((gate) => gate.id === "local_privacy_mode").detail,
    /raw/,
  );

  const placeholderD1Run = await runReadiness(address.port, {
    ...readyEnv,
    CLOUDFLARE_D1_DATABASE_ID: "your_database_id",
  });
  assert.equal(placeholderD1Run.code, 0, placeholderD1Run.stderr);
  const placeholderD1Summary = JSON.parse(placeholderD1Run.stdout);
  assert.equal(placeholderD1Summary.ok, false);
  assert.ok(placeholderD1Summary.blockers.includes("local_storage_target"));
  assert.match(
    placeholderD1Summary.gates.find((gate) => gate.id === "local_storage_target").detail,
    /placeholder-valued CLOUDFLARE_D1_DATABASE_ID/,
  );

  const partialSupabaseRun = await runReadiness(address.port, {
    SUPABASE_URL: "https://your_project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "supabase_service_role_key",
    SIGNALOPS_INGEST_TOKEN: "sop_ingest",
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator",
    SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  });
  assert.equal(partialSupabaseRun.code, 0, partialSupabaseRun.stderr);
  const partialSupabaseSummary = JSON.parse(partialSupabaseRun.stdout);
  assert.equal(partialSupabaseSummary.ok, false);
  assert.ok(partialSupabaseSummary.blockers.includes("local_storage_target"));
  assert.match(
    partialSupabaseSummary.gates.find((gate) => gate.id === "local_storage_target").detail,
    /SIGNALOPS_DATABASE_TARGET=supabase is not set; placeholder-valued SUPABASE_URL/,
  );

  const placeholderIngestRun = await runReadiness(address.port, {
    ...readyEnv,
    SIGNALOPS_INGEST_TOKEN: "your_token",
  });
  assert.equal(placeholderIngestRun.code, 0, placeholderIngestRun.stderr);
  const placeholderIngestSummary = JSON.parse(placeholderIngestRun.stdout);
  assert.equal(placeholderIngestSummary.ok, false);
  assert.ok(placeholderIngestSummary.blockers.includes("local_ingest_token"));
  assert.match(
    placeholderIngestSummary.gates.find((gate) => gate.id === "local_ingest_token").detail,
    /placeholder-valued/,
  );

  const cockpitWithoutSessionRun = await runReadiness(address.port, {
    ...readyEnv,
    SIGNALOPS_OPERATOR_TOKEN: "",
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
  });
  assert.equal(cockpitWithoutSessionRun.code, 0, cockpitWithoutSessionRun.stderr);
  const cockpitWithoutSessionSummary = JSON.parse(cockpitWithoutSessionRun.stdout);
  assert.equal(cockpitWithoutSessionSummary.ok, false);
  assert.ok(cockpitWithoutSessionSummary.blockers.includes("local_operator_access"));
  assert.match(
    cockpitWithoutSessionSummary.gates.find((gate) => gate.id === "local_operator_access").detail,
    /SESSION_SECRET/,
  );

  console.log("ok: SignalOps release readiness verifier");
} finally {
  await close(server);
}

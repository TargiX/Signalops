import assert from "node:assert/strict";
import { spawn } from "node:child_process";

function runCutover(env, args = ["--local-only", "--allow-blocked"]) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/verify-cutover.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
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

const supabaseEnv = {
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  SUPABASE_URL: "https://abc123.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase_service_role_test",
};

const missingTarget = await runCutover(supabaseEnv);
assert.equal(missingTarget.code, 0, missingTarget.stderr);
const missingTargetSummary = JSON.parse(missingTarget.stdout);
assert.equal(missingTargetSummary.ok, false);
assert.ok(missingTargetSummary.blockers.includes("database_target"));
assert.equal(missingTargetSummary.blockers.includes("cloudflare_d1_env"), false);
assert.match(
  missingTargetSummary.gates.find((gate) => gate.id === "storage_env_hint").detail,
  /SIGNALOPS_DATABASE_TARGET=supabase/,
);

const selectedSupabase = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
});
assert.equal(selectedSupabase.code, 0, selectedSupabase.stderr);
const selectedSupabaseSummary = JSON.parse(selectedSupabase.stdout);
assert.equal(selectedSupabaseSummary.ok, true);
assert.equal(selectedSupabaseSummary.blockers.length, 0);
assert.equal(selectedSupabaseSummary.gates.find((gate) => gate.id === "public_base_url").ok, true);
assert.equal(selectedSupabaseSummary.gates.find((gate) => gate.id === "secret_boundaries").ok, true);
assert.equal(selectedSupabaseSummary.gates.find((gate) => gate.id === "supabase_env").ok, true);
assert.equal(selectedSupabaseSummary.gates.find((gate) => gate.id === "workspace_identity").ok, true);

const localPublicBaseUrl = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_BASE_URL: "http://127.0.0.1:3020",
});
assert.equal(localPublicBaseUrl.code, 0, localPublicBaseUrl.stderr);
const localPublicBaseUrlSummary = JSON.parse(localPublicBaseUrl.stdout);
assert.equal(localPublicBaseUrlSummary.ok, false);
assert.ok(localPublicBaseUrlSummary.blockers.includes("public_base_url"));

const reusedIngestOperatorToken = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_ingest",
});
assert.equal(reusedIngestOperatorToken.code, 0, reusedIngestOperatorToken.stderr);
const reusedIngestOperatorTokenSummary = JSON.parse(reusedIngestOperatorToken.stdout);
assert.equal(reusedIngestOperatorTokenSummary.ok, false);
assert.ok(reusedIngestOperatorTokenSummary.blockers.includes("secret_boundaries"));
assert.match(
  reusedIngestOperatorTokenSummary.gates.find((gate) => gate.id === "secret_boundaries").detail,
  /SIGNALOPS_INGEST_TOKEN\/SIGNALOPS_OPERATOR_TOKEN/,
);

const demoWorkspace = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_WORKSPACE_SLUG: "demo",
});
assert.equal(demoWorkspace.code, 0, demoWorkspace.stderr);
const demoWorkspaceSummary = JSON.parse(demoWorkspace.stdout);
assert.equal(demoWorkspaceSummary.ok, false);
assert.ok(demoWorkspaceSummary.blockers.includes("workspace_identity"));

const missingOperatorAccess = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_OPERATOR_TOKEN: "",
});
assert.equal(missingOperatorAccess.code, 0, missingOperatorAccess.stderr);
const missingOperatorAccessSummary = JSON.parse(missingOperatorAccess.stdout);
assert.equal(missingOperatorAccessSummary.ok, false);
assert.ok(missingOperatorAccessSummary.blockers.includes("operator_access"));
assert.match(
  missingOperatorAccessSummary.gates.find((gate) => gate.id === "operator_access").detail,
  /SIGNALOPS_OPERATOR_TOKEN/,
);

const cockpitOperatorAccess = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_OPERATOR_TOKEN: "",
  SIGNALOPS_REQUIRE_AUTH: "true",
  SIGNALOPS_COCKPIT_PASSWORD: "sop_cockpit_password",
  SIGNALOPS_SESSION_SECRET: "sop_session_secret",
});
assert.equal(cockpitOperatorAccess.code, 0, cockpitOperatorAccess.stderr);
const cockpitOperatorAccessSummary = JSON.parse(cockpitOperatorAccess.stdout);
assert.equal(cockpitOperatorAccessSummary.ok, true);
assert.equal(cockpitOperatorAccessSummary.gates.find((gate) => gate.id === "operator_access").ok, true);

const httpsWebhookDelivery = await runCutover({
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: "https://ops.signalops.test/pilot",
});
assert.equal(httpsWebhookDelivery.code, 0, httpsWebhookDelivery.stderr);
const httpsWebhookDeliverySummary = JSON.parse(httpsWebhookDelivery.stdout);
assert.equal(httpsWebhookDeliverySummary.gates.find((gate) => gate.id === "pilot_delivery").ok, true);

const httpWebhookDelivery = await runCutover({
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: "http://ops.signalops.test/pilot",
});
assert.equal(httpWebhookDelivery.code, 0, httpWebhookDelivery.stderr);
const httpWebhookDeliverySummary = JSON.parse(httpWebhookDelivery.stdout);
assert.equal(httpWebhookDeliverySummary.gates.find((gate) => gate.id === "pilot_delivery").ok, false);
assert.ok(httpWebhookDeliverySummary.blockers.includes("pilot_delivery"));

const resendFallbackDelivery = await runCutover({
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  SIGNALOPS_RESEND_API_KEY: "your_key",
  RESEND_API_KEY: "re_live_fallback",
  SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@signalops.test",
  SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "pilot@signalops.test",
});
assert.equal(resendFallbackDelivery.code, 0, resendFallbackDelivery.stderr);
const resendFallbackDeliverySummary = JSON.parse(resendFallbackDelivery.stdout);
assert.equal(resendFallbackDeliverySummary.gates.find((gate) => gate.id === "pilot_delivery").ok, true);

const rawPrivacyMode = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_EVENT_PRIVACY_MODE: "raw",
});
assert.equal(rawPrivacyMode.code, 0, rawPrivacyMode.stderr);
const rawPrivacyModeSummary = JSON.parse(rawPrivacyMode.stdout);
assert.equal(rawPrivacyModeSummary.ok, false);
assert.ok(rawPrivacyModeSummary.blockers.includes("privacy_mode"));
assert.match(
  rawPrivacyModeSummary.gates.find((gate) => gate.id === "privacy_mode").detail,
  /not pilot-ready/,
);

const placeholderIngestToken = await runCutover({
  ...supabaseEnv,
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_INGEST_TOKEN: "your_token",
});
assert.equal(placeholderIngestToken.code, 0, placeholderIngestToken.stderr);
const placeholderIngestSummary = JSON.parse(placeholderIngestToken.stdout);
assert.equal(placeholderIngestSummary.ok, false);
assert.ok(placeholderIngestSummary.blockers.includes("ingest_token"));
assert.match(
  placeholderIngestSummary.gates.find((gate) => gate.id === "ingest_token").detail,
  /placeholder-valued/,
);

const placeholderSupabase = await runCutover({
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SUPABASE_URL: "https://your_project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase_service_role_test",
});
assert.equal(placeholderSupabase.code, 0, placeholderSupabase.stderr);
const placeholderSummary = JSON.parse(placeholderSupabase.stdout);
assert.equal(placeholderSummary.ok, false);
assert.ok(placeholderSummary.blockers.includes("supabase_env"));

const placeholderD1 = await runCutover({
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_DATABASE_TARGET: "cloudflare_d1",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SIGNALOPS_WORKSPACE_SLUG: "signalops-pilot",
  CLOUDFLARE_ACCOUNT_ID: "your_account_id",
  CLOUDFLARE_D1_DATABASE_ID: "db_signalops",
  CLOUDFLARE_API_TOKEN: "sop_cf_token",
});
assert.equal(placeholderD1.code, 0, placeholderD1.stderr);
const placeholderD1Summary = JSON.parse(placeholderD1.stdout);
assert.equal(placeholderD1Summary.ok, false);
assert.ok(placeholderD1Summary.blockers.includes("cloudflare_d1_env"));
assert.match(
  placeholderD1Summary.gates.find((gate) => gate.id === "cloudflare_d1_env").detail,
  /placeholder values/,
);

const placeholderPilotEmail = await runCutover({
  SIGNALOPS_BASE_URL: "https://signalops.cc",
  SIGNALOPS_DATABASE_TARGET: "supabase",
  SIGNALOPS_INGEST_TOKEN: "sop_test_ingest",
  SIGNALOPS_OPERATOR_TOKEN: "sop_test_operator",
  SUPABASE_URL: "https://your_project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "supabase_service_role_test",
  SIGNALOPS_RESEND_API_KEY: "your_key",
  SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@example.com",
  SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "pilot@example.com",
});
assert.equal(placeholderPilotEmail.code, 0, placeholderPilotEmail.stderr);
const placeholderPilotEmailSummary = JSON.parse(placeholderPilotEmail.stdout);
assert.equal(placeholderPilotEmailSummary.ok, false);
assert.ok(placeholderPilotEmailSummary.blockers.includes("pilot_delivery"));

console.log("ok: SignalOps cutover verifier");

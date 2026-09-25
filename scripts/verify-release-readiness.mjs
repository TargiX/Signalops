#!/usr/bin/env node

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const baseUrlArg = rawArgs.find((arg) => arg.startsWith("--base-url="));
const baseUrl = baseUrlArg?.slice("--base-url=".length) || process.env.SIGNALOPS_BASE_URL || "https://signalops.cc";
const allowBlocked = args.has("--allow-blocked");

function gate(id, ok, detail, required = true) {
  return { id, ok, required, detail };
}

async function request(path) {
  const response = await fetch(new URL(path, baseUrl));
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  return { response, body };
}

function collectSetupCommands(setupPlan) {
  return (setupPlan?.plan?.gates || [])
    .flatMap((item) => item.commands || [])
    .filter((command) => typeof command === "string");
}

function hasEnv(name) {
  return Boolean(process.env[name]);
}

function isPlaceholderValue(value) {
  return (
    !value ||
    /your[_-]?(account|database|project|token|key|password|secret)|example\.com|^\.\.\.$|placeholder/i.test(value)
  );
}

function envIssues(names) {
  const missing = names.filter((name) => !hasEnv(name));
  const placeholders = names.filter((name) => hasEnv(name) && isPlaceholderValue(process.env[name]));
  return { missing, placeholders };
}

function formatEnvIssues({ missing, placeholders }) {
  const parts = [];
  if (missing.length > 0) {
    parts.push(`missing ${missing.join(", ")}`);
  }
  if (placeholders.length > 0) {
    parts.push(`placeholder-valued ${placeholders.join(", ")}`);
  }
  return parts.join("; ");
}

function configuredSecretsMatch(left, right) {
  return !isPlaceholderValue(left) && !isPlaceholderValue(right) && left === right;
}

function localSecretBoundariesGate() {
  const pairs = [
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_OPERATOR_TOKEN"],
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_COCKPIT_PASSWORD"],
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_SESSION_SECRET"],
    ["SIGNALOPS_OPERATOR_TOKEN", "SIGNALOPS_COCKPIT_PASSWORD"],
    ["SIGNALOPS_COCKPIT_PASSWORD", "SIGNALOPS_SESSION_SECRET"],
  ];
  const conflicts = pairs
    .filter(([left, right]) => configuredSecretsMatch(process.env[left], process.env[right]))
    .map(([left, right]) => `${left}/${right}`);

  return gate(
    "local_secret_boundaries",
    conflicts.length === 0,
    conflicts.length === 0
      ? "Local ingest, operator, cockpit, and session secrets are separated."
      : `Local secrets are reused across pilot boundaries: ${conflicts.join(", ")}.`,
  );
}

function localStorageTargetGate() {
  const target = process.env.SIGNALOPS_DATABASE_TARGET;
  const d1Env = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_API_TOKEN"];
  const supabaseEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const d1Issues = envIssues(d1Env);
  const supabaseIssues = envIssues(supabaseEnv);
  const hasAnyD1Env = d1Env.some(hasEnv);
  const hasAnySupabaseEnv = supabaseEnv.some(hasEnv);
  const d1Ready = target === "cloudflare_d1" && d1Env.every((name) => hasEnv(name) && !isPlaceholderValue(process.env[name]));
  const supabaseReady =
    target === "supabase" && supabaseEnv.every((name) => hasEnv(name) && !isPlaceholderValue(process.env[name]));

  if (d1Ready) {
    return gate("local_storage_target", true, "Local env selects an existing Cloudflare D1 target.");
  }

  if (supabaseReady) {
    return gate("local_storage_target", true, "Local env selects an existing Supabase target.");
  }

  if (target === "cloudflare_d1") {
    return gate(
      "local_storage_target",
      false,
      `SIGNALOPS_DATABASE_TARGET=cloudflare_d1 but D1 env is not ready: ${formatEnvIssues(d1Issues)}.`,
    );
  }

  if (target === "supabase") {
    return gate(
      "local_storage_target",
      false,
      `SIGNALOPS_DATABASE_TARGET=supabase but Supabase env is not ready: ${formatEnvIssues(supabaseIssues)}.`,
    );
  }

  if (hasAnyD1Env) {
    const issueText = formatEnvIssues(d1Issues);
    return gate(
      "local_storage_target",
      false,
      `Cloudflare D1 env is present, but SIGNALOPS_DATABASE_TARGET=cloudflare_d1 is not set${
        issueText ? `; ${issueText}` : ""
      }.`,
    );
  }

  if (hasAnySupabaseEnv) {
    const issueText = formatEnvIssues(supabaseIssues);
    return gate(
      "local_storage_target",
      false,
      `Supabase env is present, but SIGNALOPS_DATABASE_TARGET=supabase is not set${
        issueText ? `; ${issueText}` : ""
      }.`,
    );
  }

  return gate(
    "local_storage_target",
    false,
    "No durable storage target is selected. Reuse an existing D1 database or approved Supabase project.",
  );
}

function localOperatorAccessGate() {
  const operatorTokenReady =
    hasEnv("SIGNALOPS_OPERATOR_TOKEN") && !isPlaceholderValue(process.env.SIGNALOPS_OPERATOR_TOKEN);
  const cockpitReady =
    process.env.SIGNALOPS_REQUIRE_AUTH === "true" &&
    hasEnv("SIGNALOPS_COCKPIT_PASSWORD") &&
    !isPlaceholderValue(process.env.SIGNALOPS_COCKPIT_PASSWORD) &&
    hasEnv("SIGNALOPS_SESSION_SECRET") &&
    !isPlaceholderValue(process.env.SIGNALOPS_SESSION_SECRET);

  if (operatorTokenReady) {
    return gate("local_operator_access", true, "Local env has a configured SIGNALOPS_OPERATOR_TOKEN.");
  }

  if (cockpitReady) {
    return gate(
      "local_operator_access",
      true,
      "Local env has cockpit password auth plus SIGNALOPS_SESSION_SECRET.",
    );
  }

  if (
    process.env.SIGNALOPS_REQUIRE_AUTH === "true" &&
    hasEnv("SIGNALOPS_COCKPIT_PASSWORD") &&
    !isPlaceholderValue(process.env.SIGNALOPS_COCKPIT_PASSWORD)
  ) {
    return gate(
      "local_operator_access",
      false,
      "Cockpit password auth is present, but SIGNALOPS_SESSION_SECRET is missing or placeholder-valued.",
    );
  }

  return gate(
    "local_operator_access",
    false,
    "Set SIGNALOPS_OPERATOR_TOKEN or cockpit password auth with SIGNALOPS_SESSION_SECRET before pilot operator use.",
  );
}

function localPrivacyModeGate() {
  if (process.env.SIGNALOPS_EVENT_PRIVACY_MODE === "raw") {
    return gate(
      "local_privacy_mode",
      false,
      "SIGNALOPS_EVENT_PRIVACY_MODE=raw is not pilot-ready; use redact before controlled pilot setup.",
    );
  }

  return gate("local_privacy_mode", true, "Local ingest privacy mode redacts user and prompt fields.");
}

function localWorkspaceIdentityGate() {
  const workspaceSlug = process.env.SIGNALOPS_WORKSPACE_SLUG?.trim();
  if (!workspaceSlug) {
    return gate("local_workspace_identity", false, "SIGNALOPS_WORKSPACE_SLUG is not set.");
  }
  if (isPlaceholderValue(workspaceSlug)) {
    return gate(
      "local_workspace_identity",
      false,
      "SIGNALOPS_WORKSPACE_SLUG is placeholder-valued; set a real non-demo workspace slug before controlled pilot setup.",
    );
  }
  if (workspaceSlug.toLowerCase() === "demo") {
    return gate(
      "local_workspace_identity",
      false,
      "SIGNALOPS_WORKSPACE_SLUG is still demo; set a real workspace slug before controlled pilot setup.",
    );
  }

  return gate("local_workspace_identity", true, `Local env scopes source events to workspace ${workspaceSlug}.`);
}

const [statusResult, healthResult, sourceKitResult, setupPlanResult] = await Promise.allSettled([
  request("/api/status"),
  request("/api/health"),
  request("/api/source-kit"),
  request("/api/setup-plan"),
]);

const status = statusResult.status === "fulfilled" && statusResult.value.response.ok ? statusResult.value.body : null;
const health = healthResult.status === "fulfilled" && healthResult.value.response.ok ? healthResult.value.body : null;
const sourceKit =
  sourceKitResult.status === "fulfilled" && sourceKitResult.value.response.ok ? sourceKitResult.value.body : null;
const setupPlan =
  setupPlanResult.status === "fulfilled" && setupPlanResult.value.response.ok ? setupPlanResult.value.body : null;
const setupCommands = collectSetupCommands(setupPlan);

const liveReachable =
  statusResult.status === "fulfilled" &&
  healthResult.status === "fulfilled" &&
  sourceKitResult.status === "fulfilled" &&
  setupPlanResult.status === "fulfilled" &&
  statusResult.value.response.ok &&
  healthResult.value.response.ok &&
  sourceKitResult.value.response.ok &&
  setupPlanResult.value.response.ok;

const sourceKitLatest =
  Boolean(sourceKit?.kit?.operatorEnv?.includes("SIGNALOPS_OPERATOR_TOKEN")) &&
  Boolean(sourceKit?.kit?.verification?.readinessGates?.includes("public_base_url")) &&
  Boolean(sourceKit?.kit?.verification?.readinessGates?.includes("first_source_event")) &&
  Boolean(sourceKit?.kit?.verification?.readinessGates?.includes("secret_boundaries")) &&
  Boolean(sourceKit?.kit?.verification?.readinessGates?.includes("workspace_identity")) &&
  Boolean(sourceKit?.kit?.verification?.readinessGates?.includes("privacy_mode")) &&
  Boolean(sourceKit?.kit?.endpoints?.setupPlan) &&
  Boolean(sourceKit?.kit?.endpoints?.sourceReport) &&
  sourceKit?.kit?.compatibility?.validationResultIncludesDiagnostics === true &&
  sourceKit?.kit?.compatibility?.ingestResponseIncludesReceipt === true &&
  sourceKit?.kit?.storageStrategy?.mode === "reuse_existing_resource" &&
  sourceKit?.kit?.storageStrategy?.newResourcesAllowed === false &&
  /--existing-only/.test(sourceKit?.kit?.storageStrategy?.discoveryCommand ?? "");
const setupPlanLatest =
  setupPlan?.plan?.totalCount === 10 &&
  setupPlan?.plan?.gates?.some((item) => item.id === "public_base_url") &&
  setupPlan?.plan?.gates?.some((item) => item.id === "operator_access") &&
  setupPlan?.plan?.gates?.some((item) => item.id === "secret_boundaries") &&
  setupPlan?.plan?.gates?.some((item) => item.id === "workspace_identity") &&
  setupPlan?.plan?.gates?.some((item) => item.id === "privacy_mode") &&
  setupPlan?.plan?.gates?.some((item) => item.id === "first_source_event");
const setupSuggestsCreate = setupCommands.some((command) => /wrangler.*d1\s+create|d1\s+create/i.test(command));

const gates = [
  gate(
    "live_endpoints",
    liveReachable,
    liveReachable
      ? "Live status, health, source-kit, and setup-plan endpoints are reachable."
      : "One or more live readiness endpoints could not be fetched.",
  ),
  gate(
    "live_stage_honesty",
    ["hosted_demo", "pilot_setup"].includes(status?.stage) && status?.canClaimProductionReady === false,
    `Live stage=${status?.stage || "unknown"}; production claim=${String(status?.canClaimProductionReady)}.`,
  ),
  gate(
    "live_no_new_resource_runbook",
    !setupSuggestsCreate,
    setupSuggestsCreate
      ? "Live setup-plan still suggests creating D1; deploy the existing-only runbook before sharing it."
      : "Live setup-plan does not suggest creating new D1 resources.",
  ),
  gate(
    "live_latest_source_contract",
    sourceKitLatest && setupPlanLatest,
    sourceKitLatest && setupPlanLatest
      ? "Live source kit and setup plan expose the current operator/source-readiness contract."
      : "Live source kit or setup plan is older than the local productization contract.",
  ),
  gate(
    "live_durable_source_ingest",
    status?.canAcceptSourceEvents === true &&
      health?.eventIngest?.durable === true &&
      health?.workspace?.pilotReady === true &&
      health?.privacy?.mode === "redact",
    status?.canAcceptSourceEvents === true &&
      health?.eventIngest?.durable === true &&
      health?.workspace?.pilotReady === true &&
      health?.privacy?.mode === "redact"
      ? "Live deployment can accept durable authenticated source events with real workspace identity and sensitive field redaction."
      : "Live source ingest is still blocked until durable storage, ingest auth, real workspace identity, and redacted privacy mode are connected.",
  ),
  gate(
    "live_pilot_intake",
    status?.canAcceptPilotRequests === true && health?.pilotIntake?.ready === true,
    status?.canAcceptPilotRequests === true && health?.pilotIntake?.ready === true
      ? "Live deployment can collect pilot requests through a configured delivery/storage path."
      : "Live pilot intake is still blocked until durable storage, webhook, alert webhook, or email delivery is connected.",
  ),
  gate(
    "live_first_source_event",
    health?.firstSourceEvent?.ready === true,
    health?.firstSourceEvent?.ready === true
      ? "Live health reports a first real source event."
      : "No first real source event is proven on live yet.",
  ),
  localStorageTargetGate(),
  localOperatorAccessGate(),
  localSecretBoundariesGate(),
  localWorkspaceIdentityGate(),
  localPrivacyModeGate(),
  gate(
    "local_ingest_token",
    hasEnv("SIGNALOPS_INGEST_TOKEN") && !isPlaceholderValue(process.env.SIGNALOPS_INGEST_TOKEN),
    hasEnv("SIGNALOPS_INGEST_TOKEN") && !isPlaceholderValue(process.env.SIGNALOPS_INGEST_TOKEN)
      ? "Local env has SIGNALOPS_INGEST_TOKEN."
      : hasEnv("SIGNALOPS_INGEST_TOKEN")
        ? "Local env exposes SIGNALOPS_INGEST_TOKEN, but it is placeholder-valued."
        : "Local env does not expose SIGNALOPS_INGEST_TOKEN to this verifier.",
  ),
];

const requiredGates = gates.filter((item) => item.required);
const ok = requiredGates.every((item) => item.ok);
const summary = {
  ok,
  baseUrl,
  mode: {
    allowBlocked,
  },
  gates,
  blockers: gates.filter((item) => item.required && !item.ok).map((item) => item.id),
  nextActions: [
    "Use an existing Cloudflare D1 database or approved Supabase project; do not create a new project/resource from this workflow.",
    "Set SIGNALOPS_DATABASE_TARGET plus the selected storage env in the existing Vercel project.",
    "Set SIGNALOPS_WORKSPACE_SLUG to a real non-demo workspace slug in the existing Vercel project.",
    "Redeploy the existing signalops.cc project after env and local productization changes are ready.",
    "Send one real server-side source event after durable storage is live, then rerun source smoke and cutover verification.",
  ],
};

console.log(JSON.stringify(summary, null, 2));

if (!ok && !allowBlocked) {
  process.exitCode = 1;
}

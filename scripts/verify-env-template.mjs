#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const templatePath = "docs/signalops-env.template";
const template = readFileSync(templatePath, "utf8");

const requiredNames = [
  "SIGNALOPS_PUBLIC_BASE_URL",
  "SIGNALOPS_BASE_URL",
  "SIGNALOPS_WORKSPACE_SLUG",
  "SIGNALOPS_REQUIRE_AUTH",
  "SIGNALOPS_COCKPIT_PASSWORD",
  "SIGNALOPS_SESSION_SECRET",
  "SIGNALOPS_SESSION_TTL_SECONDS",
  "SIGNALOPS_OPERATOR_TOKEN",
  "SIGNALOPS_INGEST_TOKEN",
  "SIGNALOPS_EVENT_PRIVACY_MODE",
  "SIGNALOPS_MAX_BATCH_EVENTS",
  "SIGNALOPS_MAX_BODY_BYTES",
  "SIGNALOPS_RATE_LIMIT_WINDOW_MS",
  "SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT",
  "SIGNALOPS_EVENT_INGEST_RATE_LIMIT",
  "SIGNALOPS_PILOT_REQUEST_RATE_LIMIT",
  "SIGNALOPS_DATABASE_TARGET",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_D1_DATABASE_ID",
  "CLOUDFLARE_API_TOKEN",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL",
  "SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET",
  "SIGNALOPS_PILOT_REQUEST_MAX_BODY_BYTES",
  "SIGNALOPS_DELIVERY_TIMEOUT_MS",
  "SIGNALOPS_ALERT_WEBHOOK_URL",
  "SIGNALOPS_ALERT_WEBHOOK_SECRET",
  "SIGNALOPS_ALERT_COST_THRESHOLD_USD",
  "SIGNALOPS_PILOT_REQUEST_EMAIL_TO",
  "SIGNALOPS_PILOT_REQUEST_EMAIL_FROM",
  "SIGNALOPS_RESEND_API_KEY",
  "RESEND_API_KEY",
  "SIGNALOPS_PILOT_FALLBACK_EMAIL",
  "NEXT_PUBLIC_SIGNALOPS_PILOT_FALLBACK_EMAIL",
  "SIGNALOPS_ALLOW_EPHEMERAL_INGEST",
  "SIGNALOPS_ALLOW_UNAUTHENTICATED_INGEST",
  "SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE",
];

for (const name of requiredNames) {
  assert.match(template, new RegExp(`(^|[^A-Z0-9_])${name}(=|\\b)`, "m"), `${name} must be documented`);
}

for (const line of template.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    continue;
  }

  const [name, ...valueParts] = trimmed.split("=");
  const value = valueParts.join("=").trim();
  if (!name) {
    continue;
  }

  if (/(TOKEN|SECRET|PASSWORD|API_KEY|SERVICE_ROLE_KEY)$/i.test(name)) {
    assert.equal(value, "", `${name} must not contain a committed value`);
  }
}

assert.match(template, /--existing-only --probe-schema/, "D1 discovery must use existing-only mode");
assert.doesNotMatch(template, /wrangler.*d1\s+create|pnpm\s+dlx\s+wrangler/i, "template must not suggest D1 creation");
assert.match(template, /^SIGNALOPS_ALLOW_EPHEMERAL_INGEST=false$/m);
assert.match(template, /^SIGNALOPS_ALLOW_UNAUTHENTICATED_INGEST=false$/m);
assert.match(template, /^SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE=false$/m);

console.log(`ok: ${templatePath}`);

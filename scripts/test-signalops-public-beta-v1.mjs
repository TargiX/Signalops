import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  deliverSignalOpsPilotRequestV1,
  normalizeSignalOpsPilotRequestV1,
} from "../src/lib/signalops/v1/pilot-request.ts";

const normalized = normalizeSignalOpsPilotRequestV1({
  email: " Operator@Example.com ",
  company: " Acme AI ",
  role: "Platform lead",
  category: "reliability",
  monthlyOperations: "100k_1m",
  useCase: "We need provider attempt visibility without sending prompts or customer identity.",
  sourcePath: "/pricing?utm_source=github",
});
assert.equal(normalized.email, "operator@example.com");
assert.equal(normalized.company, "Acme AI");
assert.equal(normalized.sourcePath, "/pricing");
assert.throws(
  () => normalizeSignalOpsPilotRequestV1({ ...normalized, useCase: "short" }),
  /10-2000/,
);
assert.throws(
  () => normalizeSignalOpsPilotRequestV1({ ...normalized, category: "prompt_dump" }),
  /category/,
);

const deliveryEnvironment = {
  SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL,
  SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET:
    process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET,
  SIGNALOPS_RESEND_API_KEY: process.env.SIGNALOPS_RESEND_API_KEY,
  SIGNALOPS_PILOT_REQUEST_EMAIL_TO: process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_TO,
  SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_FROM,
};
const originalFetch = globalThis.fetch;
const deliveryCalls = [];
process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL = "https://leads.example.test/signalops";
process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET = "test-secret-that-is-at-least-32-characters";
process.env.SIGNALOPS_RESEND_API_KEY = "re_test_only";
process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_TO = "team@example.test";
process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_FROM = "SignalOps <signalops@example.test>";
globalThis.fetch = async (url) => {
  deliveryCalls.push(String(url));
  return new Response(null, {
    status: String(url).includes("leads.example.test") ? 503 : 202,
  });
};
try {
  assert.equal(
    await deliverSignalOpsPilotRequestV1(normalized, "req_pilot123"),
    "email",
  );
  assert.deepEqual(deliveryCalls, [
    "https://leads.example.test/signalops",
    "https://api.resend.com/emails",
  ]);
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(deliveryEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

const [
  callback,
  emailAuth,
  oauthStart,
  onboardingApi,
  credentialsApi,
  canonicalIngest,
  home,
  layout,
  publicShell,
] =
  await Promise.all([
    readFile(new URL("../src/app/api/cockpit/auth/callback/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/cockpit/auth/email/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/cockpit/auth/start/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/onboarding/workspace/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/workspace/credentials/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/v1/events/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/product-home.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/public-shell.tsx", import.meta.url), "utf8"),
  ]);
assert.match(emailAuth, /shouldCreateUser: signup/);
assert.match(emailAuth, /intent=signup/);
assert.match(oauthStart, /isSignalOpsPublicSignupEnabledV1/);
assert.match(callback, /signup_completed/);
assert.match(callback, /onboarding\?state=workspace/);
assert.match(onboardingApi, /workspace_created/);
assert.match(onboardingApi, /serializeSignalOpsOperatorSessionCookieV1/);
assert.match(credentialsApi, /session\.role !== "owner"/);
assert.match(credentialsApi, /ingest_key_created/);
assert.match(canonicalIngest, /first_production_event_accepted/);
assert.match(canonicalIngest, /claimSignalOpsProductMilestoneV1/);
for (const route of ["/docs", "/pricing", "/security", "/status", "/onboarding"]) {
  assert.match(`${home}\n${publicShell}`, new RegExp(route.replace("/", "\\/")));
}
assert.match(layout, /metadataBase: new URL\("https:\/\/signalops\.cc"\)/);
assert.doesNotMatch(home, /Trusted by leading AI teams|Vercel|perplexity/i);
assert.doesNotMatch(home, />SOC 2<|>99\.9% SLA</);
assert.doesNotMatch(
  [callback, onboardingApi, credentialsApi, canonicalIngest].join("\n"),
  /captureServerProductEvent\([\s\S]{0,500}\bemail\b/,
  "Server product analytics must not attach email addresses.",
);

console.log("signalops public beta activation checks passed");

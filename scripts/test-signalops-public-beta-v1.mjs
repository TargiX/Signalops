import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";

import {
  getSignalOpsEmailTransportConfigV1,
  isSignalOpsEmailTransportConfiguredV1,
} from "../src/lib/signalops/v1/email-transport.ts";
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
  SIGNALOPS_EMAIL_TRANSPORT: process.env.SIGNALOPS_EMAIL_TRANSPORT,
  SIGNALOPS_SMTP_HOST: process.env.SIGNALOPS_SMTP_HOST,
  SIGNALOPS_SMTP_PORT: process.env.SIGNALOPS_SMTP_PORT,
  SIGNALOPS_SMTP_USER: process.env.SIGNALOPS_SMTP_USER,
  SIGNALOPS_SMTP_PASSWORD: process.env.SIGNALOPS_SMTP_PASSWORD,
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

  process.env.SIGNALOPS_SMTP_HOST = "127.0.0.1";
  process.env.SIGNALOPS_SMTP_USER = "signalops@signalops.cc";
  process.env.SIGNALOPS_SMTP_PASSWORD = "smtp-test-password";
  for (const [transport, port, configured] of [
    ["", "465", "resend"],
    ["resend", "465", "resend"],
    ["smtp", "465", "smtp"],
    ["smtp", "587", "smtp"],
    ["smtp", "0", null],
    ["smtp", "not-a-port", null],
    ["sendgrid", "465", null],
  ]) {
    process.env.SIGNALOPS_EMAIL_TRANSPORT = transport;
    process.env.SIGNALOPS_SMTP_PORT = port;
    assert.equal(getSignalOpsEmailTransportConfigV1()?.kind ?? null, configured, `${transport}:${port}`);
  }
  process.env.SIGNALOPS_EMAIL_TRANSPORT = "smtp";
  process.env.SIGNALOPS_SMTP_PORT = "587";
  delete process.env.SIGNALOPS_SMTP_PASSWORD;
  assert.equal(isSignalOpsEmailTransportConfiguredV1(), false);

  // A submission server that never offers STARTTLS must not receive credentials or a message,
  // and an SMTP failure must not silently fall back to Resend.
  const smtpCommands = [];
  const plaintextServer = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 fake.signalops.test ESMTP\r\n");
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk;
      let newline;
      while ((newline = buffered.indexOf("\r\n")) >= 0) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 2);
        smtpCommands.push(line.split(" ", 1)[0].toUpperCase());
        if (/^EHLO/i.test(line)) socket.write("250-fake.signalops.test\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (/^STARTTLS/i.test(line)) socket.write("502 5.5.1 STARTTLS not supported\r\n");
        else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 ok\r\n");
      }
    });
  });
  await new Promise((resolve) => plaintextServer.listen(0, "127.0.0.1", resolve));
  try {
    process.env.SIGNALOPS_SMTP_PORT = String(plaintextServer.address().port);
    process.env.SIGNALOPS_SMTP_PASSWORD = "smtp-test-password";
    deliveryCalls.length = 0;
    const startedAt = Date.now();
    await assert.rejects(deliverSignalOpsPilotRequestV1(normalized, "req_pilot456"), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.match(String(error.errors[1]?.message), /STARTTLS/i);
      return true;
    });
    assert.ok(Date.now() - startedAt < 4_000, "plaintext refusal should fail fast, not time out");
    assert.deepEqual(deliveryCalls, ["https://leads.example.test/signalops"]);
    assert.ok(smtpCommands.includes("EHLO"), "SMTP client never reached the fake server");
    for (const command of ["AUTH", "MAIL", "RCPT", "DATA"]) {
      assert.ok(!smtpCommands.includes(command), `${command} was sent without TLS`);
    }
  } finally {
    await new Promise((resolve) => plaintextServer.close(resolve));
  }
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

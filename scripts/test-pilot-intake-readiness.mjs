import assert from "node:assert/strict";

import {
  getPilotEmailDeliveryConfig,
  isPilotAlertWebhookFallbackConfigured,
  isPilotEmailDeliveryConfigured,
  isPilotEphemeralIntakeAllowed,
  isPilotWebhookDeliveryConfigured,
} from "../src/lib/signalops/pilot-intake-readiness.ts";

assert.equal(
  isPilotWebhookDeliveryConfigured({
    NODE_ENV: "production",
    VERCEL: "",
    SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: "https://hooks.example.com/pilot",
  }),
  false,
);
assert.equal(
  isPilotWebhookDeliveryConfigured({
    NODE_ENV: "production",
    VERCEL: "",
    SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: "https://ops.signalops.test/pilot",
  }),
  true,
);
assert.equal(
  isPilotWebhookDeliveryConfigured({
    NODE_ENV: "development",
    VERCEL: "",
    SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: "http://127.0.0.1:3030/pilot",
  }),
  true,
);
assert.equal(
  isPilotWebhookDeliveryConfigured({
    NODE_ENV: "development",
    VERCEL: "1",
    SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: "http://127.0.0.1:3030/pilot",
  }),
  false,
);
assert.equal(
  isPilotAlertWebhookFallbackConfigured({
    NODE_ENV: "production",
    VERCEL: "",
    SIGNALOPS_ALERT_WEBHOOK_URL: "https://example.com/alert",
  }),
  false,
);
assert.equal(
  isPilotAlertWebhookFallbackConfigured({
    NODE_ENV: "production",
    VERCEL: "",
    SIGNALOPS_ALERT_WEBHOOK_URL: "https://ops.signalops.test/alert",
  }),
  true,
);
assert.equal(
  isPilotAlertWebhookFallbackConfigured({
    NODE_ENV: "production",
    VERCEL: "",
    SIGNALOPS_ALERT_WEBHOOK_URL: "http://ops.signalops.test/alert",
  }),
  false,
);

assert.equal(
  isPilotEmailDeliveryConfigured({
    SIGNALOPS_RESEND_API_KEY: "your_key",
    SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@example.com",
    SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "signalops@example.com",
  }),
  false,
);
assert.equal(
  isPilotEmailDeliveryConfigured({
    SIGNALOPS_RESEND_API_KEY: "re_live_123",
    SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@signalops.test",
    SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "pilot@signalops.test",
  }),
  true,
);
assert.deepEqual(
  getPilotEmailDeliveryConfig({
    SIGNALOPS_RESEND_API_KEY: "your_key",
    RESEND_API_KEY: "re_live_fallback",
    SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@signalops.test",
    SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "pilot@signalops.test",
  }),
  {
    apiKey: "re_live_fallback",
    to: "founder@signalops.test",
    from: "pilot@signalops.test",
  },
);
assert.equal(
  getPilotEmailDeliveryConfig({
    SIGNALOPS_RESEND_API_KEY: "your_key",
    RESEND_API_KEY: "placeholder",
    SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@signalops.test",
    SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "pilot@signalops.test",
  }),
  null,
);
assert.equal(
  isPilotEmailDeliveryConfigured({
    SIGNALOPS_RESEND_API_KEY: "your_key",
    RESEND_API_KEY: "re_live_fallback",
    SIGNALOPS_PILOT_REQUEST_EMAIL_TO: "founder@signalops.test",
    SIGNALOPS_PILOT_REQUEST_EMAIL_FROM: "pilot@signalops.test",
  }),
  true,
);

assert.equal(
  isPilotEphemeralIntakeAllowed({
    NODE_ENV: "development",
    VERCEL: "",
    SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE: "true",
  }),
  true,
);
assert.equal(
  isPilotEphemeralIntakeAllowed({
    NODE_ENV: "production",
    VERCEL: "",
    SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE: "true",
  }),
  false,
);
assert.equal(
  isPilotEphemeralIntakeAllowed({
    NODE_ENV: "development",
    VERCEL: "1",
    SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE: "true",
  }),
  false,
);

console.log("ok: SignalOps pilot intake readiness");

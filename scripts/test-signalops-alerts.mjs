import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  dispatchSignalAlerts,
  evaluateSignalAlerts,
} from "../src/lib/signalops/alerts.ts";

const events = [
  {
    eventId: "generation.failed:gen_1",
    type: "generation.failed",
    occurredAt: "2026-06-25T06:00:00.000Z",
    receivedAt: "2026-06-25T06:00:00.000Z",
    generationId: "gen_1",
    providerId: "fal",
    modelId: "flux-2-pro",
    status: "failed",
    cost: 0.02,
  },
  {
    eventId: "generation.completed:gen_2",
    type: "generation.completed",
    occurredAt: "2026-06-25T06:01:00.000Z",
    receivedAt: "2026-06-25T06:01:00.000Z",
    generationId: "gen_2",
    providerId: "openai",
    modelId: "gpt-image-2",
    status: "succeeded",
    cost: 2.4,
  },
  {
    eventId: "generation.retrying:gen_3",
    type: "generation.retrying",
    occurredAt: "2026-06-25T06:02:00.000Z",
    receivedAt: "2026-06-25T06:02:00.000Z",
    generationId: "gen_3",
    providerId: "google",
    modelId: "nano-banana-pro",
    status: "retrying",
  },
];

const alerts = evaluateSignalAlerts(events, 1);
assert.deepEqual(
  alerts.map((alert) => alert.type),
  ["generation_failed", "cost_threshold", "generation_retrying"],
);
assert.equal(alerts[0].severity, "critical");
assert.equal(alerts[1].severity, "warning");

const previousUrl = process.env.SIGNALOPS_ALERT_WEBHOOK_URL;
const previousSecret = process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET;
const previousNodeEnv = process.env.NODE_ENV;
const previousVercel = process.env.VERCEL;
process.env.SIGNALOPS_ALERT_WEBHOOK_URL = "https://alerts.example.test/signalops";
process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET = "alert-secret";
process.env.VERCEL = "";

const calls = [];
const delivery = await dispatchSignalAlerts(
  alerts,
  { workspaceSlug: "demo", requestId: "req_alerts" },
  async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ ok: true });
  },
);

assert.equal(delivery?.ok, true);
assert.equal(delivery?.alertCount, 3);
assert.equal(calls.length, 1);
assert.equal(calls[0].url, "https://alerts.example.test/signalops");
const signature = calls[0].init.headers["x-signalops-signature"];
const expectedSignature = `sha256=${createHmac("sha256", "alert-secret")
  .update(String(calls[0].init.body))
  .digest("hex")}`;
assert.equal(signature, expectedSignature);

process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET = "your_secret";
const placeholderSecretCalls = [];
const placeholderSecretDelivery = await dispatchSignalAlerts(
  alerts,
  { workspaceSlug: "demo", requestId: "req_placeholder_secret" },
  async (url, init) => {
    placeholderSecretCalls.push({ url: String(url), init });
    return Response.json({ ok: true });
  },
);
assert.equal(placeholderSecretDelivery?.ok, true);
assert.equal(placeholderSecretCalls.length, 1);
assert.equal(placeholderSecretCalls[0].init.headers["x-signalops-signature"], undefined);

process.env.SIGNALOPS_ALERT_WEBHOOK_URL = "https://your_alert_receiver.example.com";
const placeholderDelivery = await dispatchSignalAlerts(
  alerts,
  { workspaceSlug: "demo", requestId: "req_placeholder" },
  async () => {
    throw new Error("placeholder URL should not be called");
  },
);
assert.equal(placeholderDelivery, null);

process.env.SIGNALOPS_ALERT_WEBHOOK_URL = "http://127.0.0.1:3030/signalops-alerts";
process.env.VERCEL = "";
const localHttpCalls = [];
const localHttpDelivery = await dispatchSignalAlerts(
  alerts,
  { workspaceSlug: "demo", requestId: "req_local_http" },
  async (url, init) => {
    localHttpCalls.push({ url: String(url), init });
    return Response.json({ ok: true });
  },
);
assert.equal(localHttpDelivery?.ok, true);
assert.equal(localHttpCalls.length, 1);

process.env.VERCEL = "1";
const productionHttpDelivery = await dispatchSignalAlerts(
  alerts,
  { workspaceSlug: "demo", requestId: "req_production_http" },
  async () => {
    throw new Error("production HTTP alert webhook should not be called");
  },
);
assert.equal(productionHttpDelivery, null);

if (previousUrl == null) {
  delete process.env.SIGNALOPS_ALERT_WEBHOOK_URL;
} else {
  process.env.SIGNALOPS_ALERT_WEBHOOK_URL = previousUrl;
}
if (previousSecret == null) {
  delete process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET;
} else {
  process.env.SIGNALOPS_ALERT_WEBHOOK_SECRET = previousSecret;
}
if (previousNodeEnv == null) {
  delete process.env.NODE_ENV;
} else {
  process.env.NODE_ENV = previousNodeEnv;
}
if (previousVercel == null) {
  delete process.env.VERCEL;
} else {
  process.env.VERCEL = previousVercel;
}

console.log("ok: SignalOps alerts");

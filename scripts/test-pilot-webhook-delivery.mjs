import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

let webhookMode = "success";
const webhookSecret = "pilot_webhook_secret";
const webhookRequests = [];

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function signPayload(payload) {
  return `sha256=${createHmac("sha256", webhookSecret).update(payload).digest("hex")}`;
}

const webhookServer = createServer(async (request, response) => {
  const rawBody = await readRawBody(request);
  webhookRequests.push({
    method: request.method,
    url: request.url,
    headers: request.headers,
    rawBody,
    body: JSON.parse(rawBody),
  });

  if (webhookMode === "failure") {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, code: "receiver_failed" }));
    return;
  }

  if (webhookMode === "timeout") {
    setTimeout(() => {
      response.writeHead(204);
      response.end();
    }, 300);
    return;
  }

  response.writeHead(204);
  response.end();
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

const appPort = "3039";
const appBaseUrl = `http://127.0.0.1:${appPort}`;
let appServer;
let appOutput = "";

async function startApp(webhookUrl) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  appServer = spawn(command, ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", appPort], {
    env: {
      ...process.env,
      SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL: webhookUrl,
      SIGNALOPS_PILOT_REQUEST_WEBHOOK_SECRET: webhookSecret,
      SIGNALOPS_DELIVERY_TIMEOUT_MS: "100",
      SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE: "",
      VERCEL: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  appServer.stdout.on("data", (chunk) => {
    appOutput += chunk.toString();
  });
  appServer.stderr.on("data", (chunk) => {
    appOutput += chunk.toString();
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`${appBaseUrl}/api/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Next is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Next dev server did not become ready.\n${appOutput}`);
}

async function stopApp() {
  if (appServer && appServer.exitCode == null && !appServer.killed) {
    appServer.kill("SIGTERM");
  }

  if (appServer) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      appServer.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

async function submitPilotRequest(email) {
  const response = await fetch(`${appBaseUrl}/api/pilot-requests`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      name: "Webhook Pilot",
      email,
      company: "Webhook Studio",
      productUrl: "https://example.com",
      generationVolume: "25k images/month",
      providers: "fal, OpenAI",
      primaryPain: "Retry storms and timeout incidents are hard to debug.",
      urgency: "this_month",
      desiredOutcome: "Know which provider and model are causing failures before users report them.",
      useCase: "We run image generation jobs across multiple providers and need latency, retry, and cost visibility before a pilot.",
    }),
  });
  const body = await response.json();
  return { response, body };
}

try {
  const webhookAddress = await listen(webhookServer);
  await startApp(`http://127.0.0.1:${webhookAddress.port}/pilot-webhook`);

  webhookMode = "success";
  const success = await submitPilotRequest("success@example.com");
  assert.equal(success.response.status, 202);
  assert.equal(success.body.ok, true);
  assert.equal(success.body.deliveries.length, 1);
  assert.equal(success.body.deliveries[0].target, "webhook");
  assert.equal(success.body.deliveries[0].ok, true);
  assert.equal(success.body.deliveries[0].status, 204);
  assert.equal(success.body.deliveries[0].signed, true);
  assert.match(success.body.deliveries[0].deliveryId, /^del_webhook_/);
  assert.equal(Number.isNaN(new Date(success.body.deliveries[0].attemptedAt).getTime()), false);
  assert.equal(typeof success.body.deliveries[0].durationMs, "number");
  assert.ok(success.body.deliveries[0].durationMs >= 0);

  const receivedSuccess = webhookRequests.at(-1);
  assert.equal(receivedSuccess.method, "POST");
  assert.equal(receivedSuccess.url, "/pilot-webhook");
  assert.equal(receivedSuccess.headers["x-signalops-event"], "pilot.requested");
  assert.equal(receivedSuccess.headers["x-signalops-delivery-id"], success.body.deliveries[0].deliveryId);
  assert.equal(receivedSuccess.headers["x-signalops-signature"], signPayload(receivedSuccess.rawBody));
  assert.equal(receivedSuccess.body.type, "pilot.requested");
  assert.equal(receivedSuccess.body.pilotRequest.email, "success@example.com");
  assert.equal(receivedSuccess.body.pilotRequest.qualification.tier, "strong_fit");
  assert.equal(receivedSuccess.body.qualification.tier, "strong_fit");
  assert.match(receivedSuccess.body.links.sourceKit, /^http:\/\/(localhost|127\.0\.0\.1):3039\/api\/source-kit$/);
  assert.match(receivedSuccess.body.links.docs, /^http:\/\/(localhost|127\.0\.0\.1):3039\/docs$/);
  assert.equal(receivedSuccess.body.integration.validateFirst, true);
  assert.deepEqual(receivedSuccess.body.integration.requiredServerEnv, [
    "SIGNALOPS_BASE_URL",
    "SIGNALOPS_INGEST_TOKEN",
  ]);
  assert.match(receivedSuccess.body.integration.preflightCommands[0], /verify:pilot-preflight -- --allow-storage-gate/);
  assert.match(receivedSuccess.body.operatorNextActions.join(" "), /representative source-event payload/);

  webhookMode = "failure";
  const failure = await submitPilotRequest("failure@example.com");
  assert.equal(failure.response.status, 424);
  assert.equal(failure.body.ok, false);
  assert.equal(failure.body.code, "pilot_intake_delivery_failed");
  assert.equal(failure.body.deliveries.length, 1);
  assert.equal(failure.body.deliveries[0].target, "webhook");
  assert.equal(failure.body.deliveries[0].ok, false);
  assert.equal(failure.body.deliveries[0].status, 500);
  assert.equal(failure.body.deliveries[0].signed, true);
  assert.match(failure.body.deliveries[0].deliveryId, /^del_webhook_/);
  assert.equal(typeof failure.body.deliveries[0].durationMs, "number");
  assert.match(failure.body.deliveries[0].error, /webhook responded with 500/);
  assert.equal(failure.body.fallbackPackage.type, "signalops.pilot_request");
  assert.equal(failure.body.fallbackPackage.request.email, "failure@example.com");
  assert.equal(failure.body.fallbackPackage.qualification.tier, "strong_fit");
  assert.match(failure.body.fallbackPackage.links.sourceKit, /^http:\/\/(localhost|127\.0\.0\.1):3039\/api\/source-kit$/);
  assert.match(
    failure.body.fallbackPackage.integration.preflightCommands[0],
    /verify:pilot-preflight -- --allow-storage-gate/,
  );
  assert.match(
    failure.body.fallbackPackage.acceptanceChecklist.firstEventProof.join("\n"),
    /demoDataIncluded=false/,
  );
  assert.match(
    failure.body.fallbackPackage.acceptanceChecklist.nonGoals.join("\n"),
    /validation-only requests/,
  );
  assert.equal(failure.body.fallbackPackage.sourceEventSample.providerId, "fal");

  const receivedFailure = webhookRequests.at(-1);
  assert.equal(receivedFailure.headers["x-signalops-delivery-id"], failure.body.deliveries[0].deliveryId);
  assert.equal(receivedFailure.headers["x-signalops-signature"], signPayload(receivedFailure.rawBody));

  webhookMode = "timeout";
  const timedOut = await submitPilotRequest("timeout@example.com");
  assert.equal(timedOut.response.status, 424);
  assert.equal(timedOut.body.ok, false);
  assert.equal(timedOut.body.deliveries.length, 1);
  assert.equal(timedOut.body.deliveries[0].target, "webhook");
  assert.equal(timedOut.body.deliveries[0].ok, false);
  assert.match(timedOut.body.deliveries[0].error, /timed out after 100ms/);
  assert.equal(typeof timedOut.body.deliveries[0].durationMs, "number");
  assert.ok(timedOut.body.deliveries[0].durationMs >= 90);
  assert.equal(timedOut.body.fallbackPackage.request.email, "timeout@example.com");

  console.log("ok: SignalOps pilot webhook delivery");
} finally {
  await stopApp();
  await close(webhookServer);
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

async function findFreePort() {
  const probe = createServer();

  return await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to resolve a free local port."));
          return;
        }

        resolve(String(address.port));
      });
    });
  });
}

const port = await findFreePort();
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(command, ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  env: {
    ...process.env,
    SIGNALOPS_ALLOW_EPHEMERAL_INGEST: "true",
    SIGNALOPS_ALLOW_EPHEMERAL_PILOT_INTAKE: "true",
    SIGNALOPS_EVENT_VALIDATE_RATE_LIMIT: "1",
    SIGNALOPS_EVENT_INGEST_RATE_LIMIT: "1",
    SIGNALOPS_PILOT_REQUEST_RATE_LIMIT: "1",
    SIGNALOPS_RATE_LIMIT_WINDOW_MS: "60000",
    SIGNALOPS_INGEST_TOKEN: "sop_rate_limit_ingest",
    SIGNALOPS_WORKSPACE_SLUG: "signalops-rate-limit-test",
    VERCEL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
server.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

async function stopServer() {
  if (server.exitCode == null && !server.killed) {
    server.kill("SIGTERM");
  }

  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30000) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) {
        return;
      }
    } catch {
      // Keep polling until Next is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Next dev server did not become ready.\n${output}`);
}

const eventPayload = {
  type: "generation.completed",
  generationId: "gen_rate_limit_001",
  providerId: "fal",
  modelId: "flux-2-pro",
  status: "succeeded",
  durationMs: 1200,
  cost: 0.02,
};

const pilotPayload = {
  name: "Maya Chen",
  email: "maya@signalops.test",
  company: "SignalOps Test",
  generationVolume: "25k images/month",
  providers: "fal, OpenAI",
  primaryPain: "Retry storms hide provider reliability issues.",
  urgency: "this_month",
  desiredOutcome: "Know when to route away from a degraded provider.",
  useCase: "Production image generation API with background retries and provider failover.",
};

async function postJson(path, body, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

function assertRateLimited(result, bucket) {
  assert.equal(result.response.status, 429);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.code, "rate_limited");
  assert.equal(result.body.bucket, bucket);
  assert.equal(result.response.headers.get("x-ratelimit-bucket"), bucket);
  assert.equal(result.response.headers.get("x-ratelimit-limit"), "1");
  assert.equal(result.response.headers.get("x-ratelimit-remaining"), "0");
  assert.ok(Number(result.response.headers.get("retry-after")) >= 1);
}

try {
  await waitForServer();

  const firstValidation = await postJson("/api/events/validate", eventPayload);
  assert.equal(firstValidation.response.status, 200);
  const secondValidation = await postJson("/api/events/validate", eventPayload);
  assertRateLimited(secondValidation, "event_validation");

  const ingestHeaders = { authorization: "Bearer sop_rate_limit_ingest" };
  const firstIngest = await postJson("/api/events", eventPayload, { headers: ingestHeaders });
  assert.equal(firstIngest.response.status, 200);
  const secondIngest = await postJson("/api/events", eventPayload, { headers: ingestHeaders });
  assertRateLimited(secondIngest, "event_ingest");

  const firstPilotRequest = await postJson("/api/pilot-requests", pilotPayload);
  assert.equal(firstPilotRequest.response.status, 202);
  const secondPilotRequest = await postJson("/api/pilot-requests", pilotPayload);
  assertRateLimited(secondPilotRequest, "pilot_request");

  console.log("ok: SignalOps rate limits");
} finally {
  await stopServer();
}

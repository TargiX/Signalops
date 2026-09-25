import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = "3039";
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const server = spawn(command, ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  env: {
    ...process.env,
    SIGNALOPS_OPERATOR_TOKEN: "sop_operator_page_guard",
    SIGNALOPS_REQUIRE_AUTH: "",
    SIGNALOPS_COCKPIT_PASSWORD: "",
    SIGNALOPS_SESSION_SECRET: "",
    VERCEL: "1",
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

async function requestText(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const body = await response.text();
  return { response, body };
}

try {
  await waitForServer();

  const cockpit = await requestText("/cockpit");
  assert.equal(cockpit.response.status, 200);
  assert.match(cockpit.body, /SignalOps/);
  assert.doesNotMatch(cockpit.body, /Operator auth required/);

  const demoSnapshot = await fetch(`${baseUrl}/api/snapshot?range=24h`);
  const demoSnapshotBody = await demoSnapshot.json();
  assert.equal(demoSnapshot.status, 200);
  assert.equal(demoSnapshotBody.sourceOverlay.demoDataIncluded, true);
  assert.equal(demoSnapshotBody.sourceOverlay.sourceEventsIncluded, false);

  const sourceReport = await requestText("/source-report");
  assert.equal(sourceReport.response.status, 200);
  assert.match(sourceReport.body, /Browser operator auth required/);
  assert.match(sourceReport.body, /Operator API tokens are still supported for CLI\/API report export/);
  assert.doesNotMatch(sourceReport.body, /Source-only report/);
  assert.doesNotMatch(sourceReport.body, /Real source events, no seeded demo data/);

  const pilotRequests = await requestText("/pilot-requests");
  assert.equal(pilotRequests.response.status, 200);
  assert.match(pilotRequests.body, /Operator auth required/);
  assert.doesNotMatch(pilotRequests.body, /No captured pilot requests/);

  console.log("ok: SignalOps operator page guards");
} finally {
  await stopServer();
}

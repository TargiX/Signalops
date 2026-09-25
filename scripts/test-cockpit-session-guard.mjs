import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = "3041";
const baseUrl = `http://127.0.0.1:${port}`;
const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const server = spawn(command, ["exec", "next", "dev", "--hostname", "127.0.0.1", "--port", port], {
  env: {
    ...process.env,
    SIGNALOPS_REQUIRE_AUTH: "true",
    SIGNALOPS_COCKPIT_PASSWORD: "session-guard-password",
    SIGNALOPS_SESSION_SECRET: "",
    SIGNALOPS_OPERATOR_TOKEN: "",
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

try {
  await waitForServer();

  const cockpit = await fetch(`${baseUrl}/cockpit`, { redirect: "manual" });
  assert.equal(cockpit.status, 200);

  const sourceReport = await fetch(`${baseUrl}/source-report`, { redirect: "manual" });
  assert.equal(sourceReport.status, 307);
  assert.match(sourceReport.headers.get("location") || "", /\/login\?next=%2Fsource-report$/);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      next: "/source-report",
      password: "session-guard-password",
    }).toString(),
  });

  assert.equal(login.status, 303);
  assert.match(login.headers.get("location") || "", /\/login\?error=session_secret&next=%2Fsource-report$/);
  assert.equal(login.headers.get("set-cookie"), null);

  const loginPage = await fetch(`${baseUrl}/login?error=session_secret&next=%2Fsource-report`);
  const body = await loginPage.text();
  assert.equal(loginPage.status, 200);
  assert.match(body, /Production cockpit sessions require SIGNALOPS_SESSION_SECRET/);

  console.log("ok: SignalOps cockpit session guard");
} finally {
  await stopServer();
}

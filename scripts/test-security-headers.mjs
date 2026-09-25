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
    SIGNALOPS_OPERATOR_TOKEN: "sop_security_headers",
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

function assertSecurityHeaders(response, path) {
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
  assert.equal(response.headers.get("x-frame-options"), "DENY", path);
  assert.equal(response.headers.get("referrer-policy"), "strict-origin-when-cross-origin", path);
  assert.equal(response.headers.get("x-dns-prefetch-control"), "off", path);

  const permissionsPolicy = response.headers.get("permissions-policy") || "";
  assert.match(permissionsPolicy, /camera=\(\)/, path);
  assert.match(permissionsPolicy, /microphone=\(\)/, path);
  assert.match(permissionsPolicy, /geolocation=\(\)/, path);
  assert.match(permissionsPolicy, /payment=\(\)/, path);
}

try {
  await waitForServer();

  for (const path of ["/", "/api/status", "/api/openapi"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.ok, true, `${path} should respond successfully`);
    assertSecurityHeaders(response, path);
  }

  console.log("ok: SignalOps security headers");
} finally {
  await stopServer();
}

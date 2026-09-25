import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.headers.authorization !== "Bearer cf_test_token") {
    jsonResponse(response, 401, { success: false, errors: [{ message: "missing test token" }] });
    return;
  }

  if (request.method === "GET" && url.pathname === "/accounts") {
    jsonResponse(response, 200, { success: true, result: [{ id: "acct_signalops", name: "SignalOps" }] });
    return;
  }

  if (request.method === "GET" && url.pathname === "/accounts/acct_empty/d1/database") {
    jsonResponse(response, 200, { success: true, result: [] });
    return;
  }

  if (request.method === "GET" && url.pathname === "/accounts/acct_signalops/d1/database") {
    jsonResponse(response, 200, {
      success: true,
      result: [{ uuid: "db_signalops", name: "signalops-prod", created_at: "2026-06-25T00:00:00.000Z" }],
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/accounts/acct_signalops/d1/database/db_signalops/query") {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const sql = String(body.sql);
    if (sql.includes("type = 'table'")) {
      jsonResponse(response, 200, {
        success: true,
        result: [
          {
            results: [
              { name: "signalops_events" },
              { name: "signalops_pilot_request_activity" },
              { name: "signalops_pilot_requests" },
            ],
          },
        ],
      });
      return;
    }

    if (sql.includes("PRAGMA table_info(signalops_events)")) {
      jsonResponse(response, 200, {
        success: true,
        result: [
          {
            results: [
              { name: "event_id", pk: 2 },
              { name: "workspace_slug", pk: 1 },
              { name: "type", pk: 0 },
            ],
          },
        ],
      });
      return;
    }

    jsonResponse(response, 200, {
      success: true,
      result: [
        {
          results: [
            { name: "signalops_events_workspace_model_idx" },
            { name: "signalops_events_workspace_occurred_at_idx" },
            { name: "signalops_events_workspace_provider_idx" },
            { name: "signalops_events_workspace_provider_model_idx" },
          ],
        },
      ],
    });
    return;
  }

  jsonResponse(response, 404, { success: false, errors: [{ message: `unexpected ${request.method} ${url.pathname}` }] });
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

function runDiscovery(args, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/discover-cloudflare-d1.mjs",
        `--api-base-url=http://127.0.0.1:${port}`,
        "--probe-schema",
        ...args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: "cf_test_token",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

try {
  const address = await listen(server);
  const jsonRun = await runDiscovery(["--json"], address.port);
  assert.equal(jsonRun.code, 0, jsonRun.stderr);
  assert.equal(jsonRun.stdout.includes("cf_test_token"), false);
  const summary = JSON.parse(jsonRun.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.accounts[0].id, "acct_signalops");
  assert.equal(summary.accounts[0].databases[0].id, "db_signalops");
  assert.equal(summary.accounts[0].databases[0].signalopsSchema.ok, true);
  assert.equal(summary.accounts[0].databases[0].signalopsSchema.exactEventLookup.ok, true);
  assert.deepEqual(summary.accounts[0].databases[0].vercelEnvCommands, [
    "printf 'cloudflare_d1' | vercel env add SIGNALOPS_DATABASE_TARGET production",
    "printf 'acct_signalops' | vercel env add CLOUDFLARE_ACCOUNT_ID production",
    "printf 'db_signalops' | vercel env add CLOUDFLARE_D1_DATABASE_ID production",
    "vercel env add CLOUDFLARE_API_TOKEN production",
  ]);
  assert.deepEqual(summary.accounts[0].databases[0].schemaApplyCommands, [
    "pnpm prepare:cloudflare-d1-sql --write tmp/signalops-d1.sql",
    "CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID='acct_signalops' CLOUDFLARE_D1_DATABASE_ID='db_signalops' pnpm apply:cloudflare-d1-schema -- --probe-schema",
  ]);

  const humanRun = await runDiscovery([], address.port);
  assert.equal(humanRun.code, 0, humanRun.stderr);
  assert.match(humanRun.stdout, /SignalOps schema: ready/);
  assert.match(humanRun.stdout, /Existing-project Vercel env commands/);
  assert.match(humanRun.stdout, /Existing-D1 schema apply commands/);
  assert.equal(humanRun.stdout.includes("cf_test_token"), false);

  const existingOnlyRun = await runDiscovery(["--existing-only", "--account-id=acct_signalops", "--json"], address.port);
  assert.equal(existingOnlyRun.code, 0, existingOnlyRun.stderr);
  assert.equal(JSON.parse(existingOnlyRun.stdout).ok, true);

  const emptyExistingOnlyRun = await runDiscovery(["--existing-only", "--account-id=acct_empty", "--json"], address.port);
  assert.equal(emptyExistingOnlyRun.code, 1);
  const emptySummary = JSON.parse(emptyExistingOnlyRun.stdout);
  assert.equal(emptySummary.ok, false);
  assert.match(emptySummary.error, /Do not create a new Cloudflare project\/database/);

  console.log("ok: Cloudflare D1 discovery");
} finally {
  await close(server);
}

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const appliedStatements = [];

function jsonResponse(response, statusCode, body) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.headers.authorization !== "Bearer cf_apply_token") {
    jsonResponse(response, 401, { success: false, errors: [{ message: "missing apply token" }] });
    return;
  }

  if (request.method !== "POST" || url.pathname !== "/accounts/acct_signalops/d1/database/db_signalops/query") {
    jsonResponse(response, 404, { success: false, errors: [{ message: `unexpected ${request.method} ${url.pathname}` }] });
    return;
  }

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

  if (sql.includes("type = 'index'")) {
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

  appliedStatements.push(sql);
  jsonResponse(response, 200, { success: true, result: [{ results: [] }] });
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

function runApply(args, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "scripts/apply-cloudflare-d1-schema.mjs",
        `--api-base-url=http://127.0.0.1:${port}`,
        "--account-id=acct_signalops",
        "--database-id=db_signalops",
        ...args,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          CLOUDFLARE_API_TOKEN: "cf_apply_token",
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
  const dryRun = await runApply(["--dry-run", "--json"], address.port);
  assert.equal(dryRun.code, 0, dryRun.stderr);
  assert.equal(dryRun.stdout.includes("cf_apply_token"), false);
  const dryRunSummary = JSON.parse(dryRun.stdout);
  assert.equal(dryRunSummary.dryRun, true);
  assert.equal(dryRunSummary.statementCount, 12);
  assert.equal(appliedStatements.length, 0);

  const applyRun = await runApply(["--probe-schema", "--json"], address.port);
  assert.equal(applyRun.code, 0, applyRun.stderr);
  assert.equal(applyRun.stdout.includes("cf_apply_token"), false);
  const applySummary = JSON.parse(applyRun.stdout);
  assert.equal(applySummary.ok, true);
  assert.equal(applySummary.statementCount, 12);
  assert.equal(applySummary.appliedStatements, 12);
  assert.equal(applySummary.schema.ok, true);
  assert.equal(applySummary.schema.exactEventLookup.ok, true);
  assert.deepEqual(applySummary.schema.exactEventLookup.columns, ["workspace_slug", "event_id"]);
  assert.match(appliedStatements[0], /^CREATE TABLE IF NOT EXISTS signalops_events/);
  assert.match(appliedStatements.at(-1), /^CREATE INDEX IF NOT EXISTS signalops_pilot_request_activity_created_at_idx/);

  console.log("ok: Cloudflare D1 schema apply");
} finally {
  await close(server);
}

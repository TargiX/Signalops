#!/usr/bin/env node

import { readFileSync } from "node:fs";

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const args = new Set(rawArgs);
const accountIdArg = rawArgs.find((arg) => arg.startsWith("--account-id="));
const databaseIdArg = rawArgs.find((arg) => arg.startsWith("--database-id="));
const sqlArg = rawArgs.find((arg) => arg.startsWith("--sql="));
const baseUrlArg = rawArgs.find((arg) => arg.startsWith("--api-base-url="));
const accountId = accountIdArg?.slice("--account-id=".length) || process.env.CLOUDFLARE_ACCOUNT_ID;
const databaseId = databaseIdArg?.slice("--database-id=".length) || process.env.CLOUDFLARE_D1_DATABASE_ID;
const sqlPath = sqlArg?.slice("--sql=".length) || "tmp/signalops-d1.sql";
const apiBaseUrl = baseUrlArg?.slice("--api-base-url=".length) || "https://api.cloudflare.com/client/v4";
const dryRun = args.has("--dry-run");
const jsonOutput = args.has("--json");
const probeSchema = args.has("--probe-schema");
const help = args.has("--help") || args.has("-h");

const requiredTables = ["signalops_events", "signalops_pilot_requests", "signalops_pilot_request_activity"];
const requiredIndexes = [
  "signalops_events_workspace_occurred_at_idx",
  "signalops_events_workspace_provider_idx",
  "signalops_events_workspace_model_idx",
  "signalops_events_workspace_provider_model_idx",
];
const requiredExactEventLookupColumns = ["workspace_slug", "event_id"];

function usage() {
  return `Usage:
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_D1_DATABASE_ID=... pnpm apply:cloudflare-d1-schema
  CLOUDFLARE_API_TOKEN=... pnpm apply:cloudflare-d1-schema -- --account-id=abc --database-id=db --sql=tmp/signalops-d1.sql --probe-schema

Options:
  --account-id=<id>      Cloudflare account id. Defaults to CLOUDFLARE_ACCOUNT_ID.
  --database-id=<id>     D1 database id. Defaults to CLOUDFLARE_D1_DATABASE_ID.
  --sql=<path>           SQL file to apply. Default: tmp/signalops-d1.sql.
  --dry-run              Parse and print the statements without applying them.
  --probe-schema         Verify required SignalOps tables and source-report indexes after apply.
  --json                 Print machine-readable output.
`;
}

function cloudflareToken() {
  return process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let quote = null;
  let lineComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        current += char;
      }
      continue;
    }

    if (!quote && char === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }

    if ((char === "'" || char === '"') && sql[index - 1] !== "\\") {
      quote = quote === char ? null : quote || char;
      current += char;
      continue;
    }

    if (char === ";" && !quote) {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const finalStatement = current.trim();
  if (finalStatement) {
    statements.push(finalStatement);
  }

  return statements;
}

async function cloudflareRequest(path, init = {}) {
  const token = cloudflareToken();
  if (!token) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN or CF_API_TOKEN.");
  }
  if (!accountId) {
    throw new Error("Missing CLOUDFLARE_ACCOUNT_ID or --account-id.");
  }
  if (!databaseId) {
    throw new Error("Missing CLOUDFLARE_D1_DATABASE_ID or --database-id.");
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.json();
  if (!response.ok || body.success === false) {
    const message = body.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Cloudflare API request failed with ${response.status}`);
  }
  return body.result;
}

async function queryD1(sql) {
  const encodedAccountId = encodeURIComponent(accountId);
  const encodedDatabaseId = encodeURIComponent(databaseId);
  const result = await cloudflareRequest(`/accounts/${encodedAccountId}/d1/database/${encodedDatabaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  return result?.[0]?.results ?? [];
}

async function probeSignalOpsSchema() {
  const tableRows = await queryD1(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN ('signalops_events', 'signalops_pilot_requests', 'signalops_pilot_request_activity')
     ORDER BY name`,
  );
  const tables = tableRows.map((row) => row.name).filter(Boolean);
  const indexRows = await queryD1(
    `SELECT name FROM sqlite_master
     WHERE type = 'index'
       AND name IN (
         'signalops_events_workspace_occurred_at_idx',
         'signalops_events_workspace_provider_idx',
         'signalops_events_workspace_model_idx',
         'signalops_events_workspace_provider_model_idx'
       )
     ORDER BY name`,
  );
  const indexes = indexRows.map((row) => row.name).filter(Boolean);
  const eventColumnRows = await queryD1("PRAGMA table_info(signalops_events)");
  const exactLookupColumns = eventColumnRows
    .filter((row) => Number(row.pk) > 0)
    .sort((left, right) => Number(left.pk) - Number(right.pk))
    .map((row) => row.name)
    .filter(Boolean);
  const missingTables = requiredTables.filter((table) => !tables.includes(table));
  const missingIndexes = requiredIndexes.filter((index) => !indexes.includes(index));
  const exactEventLookupReady = requiredExactEventLookupColumns.every(
    (column, index) => exactLookupColumns[index] === column,
  );

  return {
    ok: missingTables.length === 0 && missingIndexes.length === 0 && exactEventLookupReady,
    tables,
    indexes,
    exactEventLookup: {
      ok: exactEventLookupReady,
      columns: exactLookupColumns,
      requiredColumns: requiredExactEventLookupColumns,
    },
    missingTables,
    missingIndexes,
  };
}

function printHuman(summary) {
  console.log(`SQL file: ${summary.sqlPath}`);
  console.log(`Statements: ${summary.statementCount}`);
  if (summary.dryRun) {
    console.log("Dry run: no statements were applied.");
    return;
  }
  console.log(`Applied: ${summary.appliedStatements}`);
  if (summary.schema) {
    console.log(summary.schema.ok ? "SignalOps schema: ready" : "SignalOps schema: incomplete");
    if (!summary.schema.ok) {
      const missing = [...summary.schema.missingTables, ...summary.schema.missingIndexes];
      if (!summary.schema.exactEventLookup?.ok) {
        missing.push("signalops_events exact workspace/event primary key");
      }
      console.log(`Missing: ${missing.join(", ")}`);
    }
  }
}

async function main() {
  if (help) {
    console.log(usage());
    return;
  }

  const sql = readFileSync(sqlPath, "utf8");
  const statements = splitSqlStatements(sql);
  const summary = {
    ok: true,
    dryRun,
    sqlPath,
    statementCount: statements.length,
    appliedStatements: 0,
    accountId,
    databaseId,
    schema: null,
  };

  if (!dryRun) {
    for (const statement of statements) {
      await queryD1(statement);
      summary.appliedStatements += 1;
    }
  }

  if (probeSchema && !dryRun) {
    summary.schema = await probeSignalOpsSchema();
    summary.ok = summary.schema.ok;
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printHuman(summary);
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown D1 schema apply failure";
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
    console.error("");
    console.error(usage());
  }
  process.exitCode = 1;
});

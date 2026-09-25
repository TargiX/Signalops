#!/usr/bin/env node

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const accountIdArg = rawArgs.find((arg) => arg.startsWith("--account-id="));
const limitArg = rawArgs.find((arg) => arg.startsWith("--limit="));
const baseUrlArg = rawArgs.find((arg) => arg.startsWith("--api-base-url="));
const accountIdFilter = accountIdArg?.slice("--account-id=".length) || process.env.CLOUDFLARE_ACCOUNT_ID;
const limit = Number(limitArg?.slice("--limit=".length) || 25);
const apiBaseUrl = baseUrlArg?.slice("--api-base-url=".length) || "https://api.cloudflare.com/client/v4";
const jsonOutput = args.has("--json");
const probeSchema = args.has("--probe-schema");
const existingOnly = args.has("--existing-only");
const help = args.has("--help") || args.has("-h");

function usage() {
  return `Usage:
  CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1
  CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --existing-only --probe-schema
  CLOUDFLARE_API_TOKEN=... pnpm discover:cloudflare-d1 -- --account-id=abc123 --json

Options:
  --account-id=<id>     Limit discovery to one Cloudflare account.
  --limit=<n>           Max databases per account. Default: 25.
  --probe-schema        Query each D1 database for SignalOps tables and indexes.
  --existing-only       Fail when no existing D1 database is visible; never suggests creating one.
  --json                Print machine-readable output.
`;
}

function cloudflareToken() {
  return process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
}

async function cloudflareRequest(path, init = {}) {
  const token = cloudflareToken();
  if (!token) {
    throw new Error("Missing CLOUDFLARE_API_TOKEN or CF_API_TOKEN.");
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

async function listAccounts() {
  if (accountIdFilter) {
    return [{ id: accountIdFilter, name: "configured account" }];
  }

  const result = await cloudflareRequest("/accounts?per_page=50");
  return Array.isArray(result) ? result.map((account) => ({ id: account.id, name: account.name })) : [];
}

async function listD1Databases(accountId) {
  const encodedAccountId = encodeURIComponent(accountId);
  const result = await cloudflareRequest(`/accounts/${encodedAccountId}/d1/database?per_page=${limit}`);
  return Array.isArray(result)
    ? result.map((database) => ({
        id: database.uuid || database.id,
        name: database.name,
        createdAt: database.created_at,
        version: database.version,
      }))
    : [];
}

async function queryD1(accountId, databaseId, sql) {
  const encodedAccountId = encodeURIComponent(accountId);
  const encodedDatabaseId = encodeURIComponent(databaseId);
  const result = await cloudflareRequest(`/accounts/${encodedAccountId}/d1/database/${encodedDatabaseId}/query`, {
    method: "POST",
    body: JSON.stringify({ sql }),
  });
  return result?.[0]?.results ?? [];
}

async function probeSignalOpsSchema(accountId, databaseId) {
  try {
    const tableRows = await queryD1(
      accountId,
      databaseId,
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('signalops_events', 'signalops_pilot_requests', 'signalops_pilot_request_activity')
       ORDER BY name`,
    );
    const tables = tableRows.map((row) => row.name).filter(Boolean);
    const indexRows = await queryD1(
      accountId,
      databaseId,
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
    const eventColumnRows = await queryD1(accountId, databaseId, "PRAGMA table_info(signalops_events)");
    const exactLookupColumns = eventColumnRows
      .filter((row) => Number(row.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk))
      .map((row) => row.name)
      .filter(Boolean);
    const requiredTables = ["signalops_events", "signalops_pilot_requests", "signalops_pilot_request_activity"];
    const requiredIndexes = [
      "signalops_events_workspace_occurred_at_idx",
      "signalops_events_workspace_provider_idx",
      "signalops_events_workspace_model_idx",
      "signalops_events_workspace_provider_model_idx",
    ];
    const requiredExactEventLookupColumns = ["workspace_slug", "event_id"];
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
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "unknown schema probe failure",
    };
  }
}

function envCommands(accountId, databaseId) {
  return [
    "printf 'cloudflare_d1' | vercel env add SIGNALOPS_DATABASE_TARGET production",
    `printf '${accountId}' | vercel env add CLOUDFLARE_ACCOUNT_ID production`,
    `printf '${databaseId}' | vercel env add CLOUDFLARE_D1_DATABASE_ID production`,
    "vercel env add CLOUDFLARE_API_TOKEN production",
  ];
}

function schemaApplyCommands(accountId, databaseId) {
  return [
    "pnpm prepare:cloudflare-d1-sql --write tmp/signalops-d1.sql",
    `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID='${accountId}' CLOUDFLARE_D1_DATABASE_ID='${databaseId}' pnpm apply:cloudflare-d1-schema -- --probe-schema`,
  ];
}

function printHuman(summary) {
  if (summary.accounts.length === 0) {
    console.log("No Cloudflare accounts were visible to this token.");
    if (summary.mode.existingOnly) {
      console.log("Existing-only mode: no D1 database was created.");
    }
    return;
  }

  for (const account of summary.accounts) {
    console.log(`Account: ${account.name} (${account.id})`);
    if (account.databases.length === 0) {
      console.log("  No D1 databases found.");
      continue;
    }

    for (const database of account.databases) {
      const schema = database.signalopsSchema;
      const schemaText = schema
        ? schema.ok
          ? "SignalOps schema: ready"
          : schema.error
            ? `SignalOps schema probe failed: ${schema.error}`
            : `SignalOps schema missing: ${[
                ...schema.missingTables,
                ...schema.missingIndexes,
                ...(schema.exactEventLookup?.ok ? [] : ["signalops_events exact workspace/event primary key"]),
              ].join(", ")}`
        : "SignalOps schema: not probed";
      console.log(`  - ${database.name} (${database.id})`);
      console.log(`    ${schemaText}`);
      console.log("    Existing-project Vercel env commands:");
      for (const command of envCommands(account.id, database.id)) {
        console.log(`      ${command}`);
      }
      console.log("    Existing-D1 schema apply commands:");
      for (const command of schemaApplyCommands(account.id, database.id)) {
        console.log(`      ${command}`);
      }
    }
  }

  if (!summary.ok && summary.error) {
    console.log("");
    console.log(summary.error);
  }
}

async function main() {
  if (help) {
    console.log(usage());
    return;
  }

  const accounts = await listAccounts();
  const summary = {
    ok: true,
    mode: {
      accountId: accountIdFilter || null,
      limit,
      probeSchema,
      existingOnly,
    },
    accounts: [],
  };

  for (const account of accounts) {
    const databases = await listD1Databases(account.id);
    const enrichedDatabases = [];
    for (const database of databases) {
      const signalopsSchema =
        probeSchema && database.id ? await probeSignalOpsSchema(account.id, database.id) : undefined;
      enrichedDatabases.push({
        ...database,
        signalopsSchema,
        vercelEnvCommands: envCommands(account.id, database.id),
        schemaApplyCommands: schemaApplyCommands(account.id, database.id),
      });
    }
    summary.accounts.push({ ...account, databases: enrichedDatabases });
  }

  const visibleDatabaseCount = summary.accounts.reduce((count, account) => count + account.databases.length, 0);
  if (existingOnly && visibleDatabaseCount === 0) {
    summary.ok = false;
    summary.error =
      "Existing-only mode found no D1 database. Do not create a new Cloudflare project/database from this script; reuse another approved storage path or wait for an available D1 slot.";
  }

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
    return;
  }

  printHuman(summary);
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown discovery failure";
  if (jsonOutput) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.error(message);
    console.error("");
    console.error(usage());
  }
  process.exitCode = 1;
});

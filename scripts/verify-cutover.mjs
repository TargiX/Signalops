#!/usr/bin/env node

const args = new Set(process.argv.slice(2));
const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
const baseUrl = baseUrlArg?.slice("--base-url=".length) || process.env.SIGNALOPS_BASE_URL || "https://signalops.cc";
const allowBlocked = args.has("--allow-blocked");
const localOnly = args.has("--local-only");
const probeD1 = args.has("--probe-d1");
const probeSupabase = args.has("--probe-supabase");
const requiredPilotRequestColumns = [
  "generation_volume",
  "qualification_tier",
  "qualification_signals",
  "lifecycle_status",
  "operator_note",
  "next_action_at",
  "updated_at",
];

function hasEnv(name) {
  return Boolean(process.env[name]);
}

function gate(id, ok, detail, required = true) {
  return { id, ok, required, detail };
}

function isPlaceholderValue(value) {
  return (
    !value ||
    /your[_-]?(account|database|project|token|key|password|secret)|example\.com|^\.\.\.$|placeholder/i.test(value)
  );
}

function isConfiguredProductionDeliveryUrl(value) {
  if (isPlaceholderValue(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function firstConfiguredSecret(...values) {
  return values.find((value) => !isPlaceholderValue(value));
}

function configuredSecretsMatch(left, right) {
  return !isPlaceholderValue(left) && !isPlaceholderValue(right) && left === right;
}

function publicBaseUrlReady() {
  const value = process.env.SIGNALOPS_PUBLIC_BASE_URL || process.env.SIGNALOPS_BASE_URL;
  if (isPlaceholderValue(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "0.0.0.0"].includes(url.hostname);
  } catch {
    return false;
  }
}

function secretBoundaryConflicts() {
  const pairs = [
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_OPERATOR_TOKEN"],
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_COCKPIT_PASSWORD"],
    ["SIGNALOPS_INGEST_TOKEN", "SIGNALOPS_SESSION_SECRET"],
    ["SIGNALOPS_OPERATOR_TOKEN", "SIGNALOPS_COCKPIT_PASSWORD"],
    ["SIGNALOPS_COCKPIT_PASSWORD", "SIGNALOPS_SESSION_SECRET"],
  ];

  return pairs
    .filter(([left, right]) => configuredSecretsMatch(process.env[left], process.env[right]))
    .map(([left, right]) => `${left}/${right}`);
}

function workspaceSlug() {
  return process.env.SIGNALOPS_WORKSPACE_SLUG?.trim() || "demo";
}

function operatorAccessReady() {
  const operatorTokenReady = hasEnv("SIGNALOPS_OPERATOR_TOKEN") && !isPlaceholderValue(process.env.SIGNALOPS_OPERATOR_TOKEN);
  const cockpitPasswordReady =
    process.env.SIGNALOPS_REQUIRE_AUTH === "true" &&
    hasEnv("SIGNALOPS_COCKPIT_PASSWORD") &&
    !isPlaceholderValue(process.env.SIGNALOPS_COCKPIT_PASSWORD) &&
    hasEnv("SIGNALOPS_SESSION_SECRET") &&
    !isPlaceholderValue(process.env.SIGNALOPS_SESSION_SECRET);

  return operatorTokenReady || cockpitPasswordReady;
}

async function getJson(path) {
  const response = await fetch(new URL(path, baseUrl));
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function queryD1(sql, params = []) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    },
  );
  const json = await response.json();
  if (!response.ok || json.success === false) {
    const message = json.errors?.map((error) => error.message).filter(Boolean).join("; ");
    throw new Error(message || `Cloudflare D1 query failed with ${response.status}`);
  }
  return json.result?.[0]?.results ?? [];
}

async function requestSupabase(path) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (isPlaceholderValue(url)) {
    throw new Error("SUPABASE_URL is still a placeholder.");
  }
  if (isPlaceholderValue(serviceRoleKey)) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is still a placeholder.");
  }

  const response = await fetch(`${url}/rest/v1${path}`, {
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try {
      const json = JSON.parse(text);
      message = [json.message, json.details, json.hint].filter(Boolean).join("; ");
    } catch {
      // Keep raw response text when Supabase does not return JSON.
    }
    throw new Error(message || `Supabase request failed with ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

async function main() {
  const databaseTarget = process.env.SIGNALOPS_DATABASE_TARGET;
  const cloudflareEnv = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_D1_DATABASE_ID", "CLOUDFLARE_API_TOKEN"];
  const missingCloudflareEnv = cloudflareEnv.filter((name) => !hasEnv(name));
  const hasAnyCloudflareEnv = cloudflareEnv.some((name) => hasEnv(name));
  const d1HasPlaceholders = cloudflareEnv.some((name) => isPlaceholderValue(process.env[name]));
  const d1ProbeEnvReady = missingCloudflareEnv.length === 0 && !d1HasPlaceholders;
  const d1EnvReady = databaseTarget === "cloudflare_d1" && d1ProbeEnvReady;
  const supabaseEnv = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const missingSupabaseEnv = supabaseEnv.filter((name) => !hasEnv(name));
  const hasAnySupabaseEnv = supabaseEnv.some((name) => hasEnv(name));
  const supabaseHasPlaceholders = supabaseEnv.some((name) => isPlaceholderValue(process.env[name]));
  const supabaseProbeEnvReady = missingSupabaseEnv.length === 0 && !supabaseHasPlaceholders;
  const supabaseEnvReady = databaseTarget === "supabase" && supabaseProbeEnvReady;
  const durableEnvReady = d1EnvReady || supabaseEnvReady;
  const workspaceReady =
    Boolean(process.env.SIGNALOPS_WORKSPACE_SLUG?.trim()) &&
    !isPlaceholderValue(process.env.SIGNALOPS_WORKSPACE_SLUG) &&
    workspaceSlug().toLowerCase() !== "demo";
  const pilotWebhookReady = isConfiguredProductionDeliveryUrl(process.env.SIGNALOPS_PILOT_REQUEST_WEBHOOK_URL);
  const alertWebhookReady = isConfiguredProductionDeliveryUrl(process.env.SIGNALOPS_ALERT_WEBHOOK_URL);
  const pilotEmailReady =
    Boolean(firstConfiguredSecret(process.env.SIGNALOPS_RESEND_API_KEY, process.env.RESEND_API_KEY)) &&
    hasEnv("SIGNALOPS_PILOT_REQUEST_EMAIL_TO") &&
    !isPlaceholderValue(process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_TO) &&
    hasEnv("SIGNALOPS_PILOT_REQUEST_EMAIL_FROM") &&
    !isPlaceholderValue(process.env.SIGNALOPS_PILOT_REQUEST_EMAIL_FROM);

  const gates = [
    gate(
      "public_base_url",
      publicBaseUrlReady(),
      publicBaseUrlReady()
        ? "SIGNALOPS_PUBLIC_BASE_URL or SIGNALOPS_BASE_URL is an HTTPS public URL."
        : "Set SIGNALOPS_PUBLIC_BASE_URL or SIGNALOPS_BASE_URL to the HTTPS production URL before sharing source kits or pilot handoff links.",
    ),
    gate(
      "database_target",
      databaseTarget === "cloudflare_d1" || databaseTarget === "supabase",
      databaseTarget === "cloudflare_d1"
        ? "SIGNALOPS_DATABASE_TARGET selects Cloudflare D1."
        : databaseTarget === "supabase"
          ? "SIGNALOPS_DATABASE_TARGET selects Supabase."
          : "Set SIGNALOPS_DATABASE_TARGET=cloudflare_d1 or SIGNALOPS_DATABASE_TARGET=supabase before pilot ingest.",
    ),
    ...(databaseTarget === "supabase"
      ? [
          gate(
            "supabase_env",
            supabaseProbeEnvReady,
            supabaseProbeEnvReady
              ? "Supabase URL and service-role env are present."
              : missingSupabaseEnv.length > 0
                ? `Missing ${missingSupabaseEnv.join(", ")}.`
                : "Supabase env is present but still contains placeholder values.",
          ),
        ]
      : databaseTarget === "cloudflare_d1"
        ? [
            gate(
              "cloudflare_d1_env",
              d1ProbeEnvReady,
              d1ProbeEnvReady
                ? "Cloudflare account, D1 database, and API token env are present."
                : missingCloudflareEnv.length > 0
                  ? `Missing ${missingCloudflareEnv.join(", ")}.`
                  : "Cloudflare D1 env is present but still contains placeholder values.",
            ),
          ]
        : hasAnySupabaseEnv && !hasAnyCloudflareEnv
          ? [
              gate(
                "storage_env_hint",
                false,
                "Supabase env is present, but SIGNALOPS_DATABASE_TARGET is not set. Set SIGNALOPS_DATABASE_TARGET=supabase before pilot ingest.",
                false,
              ),
            ]
          : hasAnyCloudflareEnv && !hasAnySupabaseEnv
            ? [
                gate(
                  "storage_env_hint",
                  false,
                  "Cloudflare D1 env is present, but SIGNALOPS_DATABASE_TARGET is not set. Set SIGNALOPS_DATABASE_TARGET=cloudflare_d1 before pilot ingest.",
                  false,
                ),
              ]
            : [
          gate(
            "storage_env_hint",
            false,
            "No durable storage env is selected yet. Reuse an existing Cloudflare D1 database or approved Supabase project, then set SIGNALOPS_DATABASE_TARGET.",
            false,
          ),
        ]),
    gate(
      "ingest_token",
      hasEnv("SIGNALOPS_INGEST_TOKEN") && !isPlaceholderValue(process.env.SIGNALOPS_INGEST_TOKEN),
      hasEnv("SIGNALOPS_INGEST_TOKEN") && !isPlaceholderValue(process.env.SIGNALOPS_INGEST_TOKEN)
        ? "SIGNALOPS_INGEST_TOKEN is present."
        : hasEnv("SIGNALOPS_INGEST_TOKEN")
          ? "SIGNALOPS_INGEST_TOKEN is present but placeholder-valued."
          : "Set SIGNALOPS_INGEST_TOKEN before accepting source events.",
    ),
    (() => {
      const conflicts = secretBoundaryConflicts();
      return gate(
        "secret_boundaries",
        conflicts.length === 0,
        conflicts.length === 0
          ? "Ingest, operator, cockpit, and session secrets are separated."
          : `Secrets must not be reused across pilot boundaries: ${conflicts.join(", ")}.`,
      );
    })(),
    gate(
      "workspace_identity",
      workspaceReady,
      workspaceReady
        ? `Source events are scoped to workspace ${workspaceSlug()}.`
        : "Set SIGNALOPS_WORKSPACE_SLUG to a real non-demo workspace slug before pilot ingest.",
    ),
    gate(
      "privacy_mode",
      process.env.SIGNALOPS_EVENT_PRIVACY_MODE !== "raw",
      process.env.SIGNALOPS_EVENT_PRIVACY_MODE === "raw"
        ? "SIGNALOPS_EVENT_PRIVACY_MODE=raw is not pilot-ready; use redacted ingest before controlled pilot traffic."
        : "Source ingest redacts sensitive fields by default.",
    ),
    gate(
      "operator_access",
      operatorAccessReady(),
      operatorAccessReady()
        ? "Operator access is configured with an API token or cockpit password plus session secret."
        : "Set SIGNALOPS_OPERATOR_TOKEN or cockpit password auth with SIGNALOPS_SESSION_SECRET before pilot operator use.",
    ),
    gate(
      "pilot_delivery",
      durableEnvReady || pilotWebhookReady || alertWebhookReady || pilotEmailReady,
      durableEnvReady || pilotWebhookReady || alertWebhookReady || pilotEmailReady
        ? "Pilot requests have a durable or delivery path."
        : "Configure D1, Supabase, a signed pilot webhook, the operator alert webhook, or Resend-backed email before collecting pilot demand.",
    ),
  ];

  if (probeD1) {
    if (!d1ProbeEnvReady) {
      gates.push(gate("d1_schema", false, "Cannot probe D1 until Cloudflare D1 env is complete."));
    } else {
      try {
        const tableRows = await queryD1(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name IN ('signalops_events', 'signalops_pilot_requests', 'signalops_pilot_request_activity')
           ORDER BY name`,
        );
        const tables = tableRows.map((row) => row.name);
        const hasTables =
          tables.includes("signalops_events") &&
          tables.includes("signalops_pilot_requests") &&
          tables.includes("signalops_pilot_request_activity");
        gates.push(
          gate(
            "d1_schema",
            hasTables,
            hasTables
              ? "D1 contains signalops_events, signalops_pilot_requests, and signalops_pilot_request_activity."
              : `D1 schema is incomplete. Found: ${tables.join(", ") || "no SignalOps tables"}.`,
          ),
        );

        if (hasTables) {
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
          const indexes = new Set(indexRows.map((row) => row.name).filter(Boolean));
          const requiredEventIndexes = [
            "signalops_events_workspace_occurred_at_idx",
            "signalops_events_workspace_provider_idx",
            "signalops_events_workspace_model_idx",
            "signalops_events_workspace_provider_model_idx",
          ];
          const missingIndexes = requiredEventIndexes.filter((index) => !indexes.has(index));
          gates.push(
            gate(
              "d1_schema_event_report_indexes",
              missingIndexes.length === 0,
              missingIndexes.length === 0
                ? "D1 source-event report filters have workspace/range/provider/model indexes."
                : `D1 source-event report indexes are missing ${missingIndexes.join(", ")}.`,
            ),
          );

          const eventColumnRows = await queryD1("PRAGMA table_info(signalops_events)");
          const exactLookupColumns = eventColumnRows
            .filter((row) => Number(row.pk) > 0)
            .sort((left, right) => Number(left.pk) - Number(right.pk))
            .map((row) => row.name)
            .filter(Boolean);
          const exactLookupReady =
            exactLookupColumns[0] === "workspace_slug" && exactLookupColumns[1] === "event_id";
          gates.push(
            gate(
              "d1_schema_exact_event_lookup",
              exactLookupReady,
              exactLookupReady
                ? "D1 exact receipt proof lookup uses the workspace/event primary key."
                : `D1 exact receipt proof lookup is missing workspace/event primary key. Found: ${
                    exactLookupColumns.join(", ") || "no primary key columns"
                  }.`,
            ),
          );

          const columnRows = await queryD1("PRAGMA table_info(signalops_pilot_requests)");
          const columns = new Set(columnRows.map((row) => row.name).filter(Boolean));
          const missingColumns = requiredPilotRequestColumns.filter((column) => !columns.has(column));
          gates.push(
            gate(
              "d1_schema_pilot_qualification",
              missingColumns.length === 0,
              missingColumns.length === 0
                ? "D1 pilot requests include queryable qualification and lifecycle columns."
                : `D1 pilot request schema is missing ${missingColumns.join(", ")}.`,
            ),
          );
        }

        const eventRows = hasTables
          ? await queryD1("SELECT COUNT(*) AS count FROM signalops_events WHERE workspace_slug = ?", [
              workspaceSlug(),
            ])
          : [];
        const sourceEvents = Number(eventRows[0]?.count ?? 0);
        gates.push(
          gate(
            "first_source_event",
            sourceEvents > 0,
            sourceEvents > 0
              ? `D1 contains ${sourceEvents} source event(s) for the configured workspace.`
              : "D1 is ready, but no source events have been stored for this workspace yet.",
            false,
          ),
        );
      } catch (error) {
        gates.push(
          gate(
            "d1_schema",
            false,
            `D1 probe failed: ${error instanceof Error ? error.message : "unknown error"}.`,
          ),
        );
      }
    }
  }

  if (probeSupabase) {
    if (!supabaseProbeEnvReady) {
      gates.push(
        gate(
          "supabase_schema",
          false,
          missingSupabaseEnv.length > 0
            ? `Cannot probe Supabase until ${missingSupabaseEnv.join(", ")} are set.`
            : "Cannot probe Supabase while Supabase env contains placeholder values.",
        ),
      );
    } else {
      try {
        await requestSupabase(
          "/signalops_pilot_requests?select=id,generation_volume,qualification_tier,qualification_signals,lifecycle_status,operator_note,next_action_at,updated_at&limit=1",
        );
        await requestSupabase("/signalops_pilot_request_activity?select=id,pilot_request_id,type,actor,status,summary&limit=1");
        gates.push(
          gate(
            "supabase_schema_pilot_requests",
            true,
            "Supabase can read signalops_pilot_requests and pilot request activity.",
          ),
        );
      } catch (error) {
        gates.push(
          gate(
            "supabase_schema_pilot_requests",
            false,
            `Supabase pilot request table probe failed: ${
              error instanceof Error ? error.message : "unknown error"
            }.`,
          ),
        );
      }

      try {
        const params = new URLSearchParams({
          workspace_slug: `eq.${workspaceSlug()}`,
          select: "event_id",
          limit: "1",
        });
        const rows = await requestSupabase(`/signalops_events?${params.toString()}`);
        const filteredParams = new URLSearchParams({
          workspace_slug: `eq.${workspaceSlug()}`,
          select: "event_id",
          provider_id: "eq.__signalops_probe_provider__",
          model_id: "eq.__signalops_probe_model__",
          limit: "1",
        });
        filteredParams.append("occurred_at", "gte.1970-01-01T00:00:00.000Z");
        await requestSupabase(`/signalops_events?${filteredParams.toString()}`);
        const exactParams = new URLSearchParams({
          workspace_slug: `eq.${workspaceSlug()}`,
          event_id: "eq.__signalops_probe_event__",
          select: "event_id",
          limit: "1",
        });
        await requestSupabase(`/signalops_events?${exactParams.toString()}`);
        gates.push(gate("supabase_schema_events", true, "Supabase can read signalops_events with report filters."));
        gates.push(
          gate(
            "supabase_schema_exact_event_lookup",
            true,
            "Supabase can read signalops_events by workspace/event receipt proof filter.",
          ),
        );
        gates.push(
          gate(
            "first_source_event",
            Array.isArray(rows) && rows.length > 0,
            Array.isArray(rows) && rows.length > 0
              ? "Supabase contains at least one source event for the configured workspace."
              : "Supabase is ready, but no source events have been stored for this workspace yet.",
            false,
          ),
        );
      } catch (error) {
        gates.push(
          gate(
            "supabase_schema_events",
            false,
            `Supabase event table probe failed: ${error instanceof Error ? error.message : "unknown error"}.`,
          ),
        );
      }
    }
  }

  if (!localOnly) {
    try {
      const [status, setup] = await Promise.all([getJson("/api/status"), getJson("/api/setup-plan")]);
      gates.push(
        gate(
          "live_status_contract",
          status.product === "SignalOps" && Boolean(setup.ok) && Array.isArray(setup.plan?.gates),
          `Live status=${status.stage}; setup=${setup.plan?.readyCount}/${setup.plan?.totalCount}.`,
        ),
      );
      if (
        durableEnvReady &&
        hasEnv("SIGNALOPS_INGEST_TOKEN") &&
        !isPlaceholderValue(process.env.SIGNALOPS_INGEST_TOKEN)
      ) {
        gates.push(
          gate(
            "live_deployed_env",
            status.canAcceptSourceEvents === true,
            status.canAcceptSourceEvents
              ? "Live deployment can accept authenticated source events."
              : "Local env looks ready, but live deployment still rejects source events. Redeploy the existing Vercel project after adding env.",
          ),
        );
      }
    } catch (error) {
      gates.push(
        gate(
          "live_status_contract",
          false,
          `Could not verify live status contracts at ${baseUrl}: ${
            error instanceof Error ? error.message : "unknown error"
          }.`,
        ),
      );
    }
  }

  const requiredGates = gates.filter((item) => item.required);
  const ok = requiredGates.every((item) => item.ok);
  const summary = {
    ok,
    baseUrl: localOnly ? null : baseUrl,
    mode: {
      localOnly,
      probeD1,
      allowBlocked,
      probeSupabase,
    },
    gates,
    blockers: gates.filter((item) => item.required && !item.ok).map((item) => item.id),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (!ok && !allowBlocked) {
    process.exitCode = 1;
  }
}

await main();

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import pg from "pg";

const connectionString = process.env.SIGNALOPS_POSTGRES_TEST_URL?.trim();
if (!connectionString) {
  throw new Error("SIGNALOPS_POSTGRES_TEST_URL is required");
}

const target = new URL(connectionString);
const databaseName = decodeURIComponent(target.pathname.slice(1));
const confirmedDatabase = process.env.SIGNALOPS_POSTGRES_TEST_CONFIRM?.trim();
if (
  target.protocol !== "postgresql:" ||
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  !/^signalops(?:_[a-z0-9]+)*_test$/u.test(databaseName) ||
  confirmedDatabase !== databaseName
) {
  throw new Error(
    "PostgreSQL migration tests require a confirmed loopback signalops_*_test database",
  );
}

const migrations = await Promise.all([
  readFile(new URL("../supabase/migrations/0001_signalops_v1_core.sql", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../supabase/migrations/20260823090716_signalops_v1_production_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20260823150000_signalops_v1_operation_subject_index.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20260824011500_signalops_v1_slo_incident_workflow.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

const { Client } = pg;
const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });
const tenantId = `sql-test-${randomUUID()}`;
const bucketKey = randomUUID().replaceAll("-", "").padEnd(64, "0");

async function ensureRole(name, bypassRls = false) {
  const existing = await client.query("select 1 from pg_roles where rolname = $1", [name]);
  if (existing.rowCount === 0) {
    await client.query(`create role ${name} nologin${bypassRls ? " bypassrls" : ""}`);
  } else if (bypassRls) {
    await client.query(`alter role ${name} bypassrls`);
  }
}

await client.connect();
try {
  await ensureRole("anon");
  await ensureRole("authenticated");
  await ensureRole("service_role", true);
  for (const migration of migrations) await client.query(migration);

  const tables = await client.query(
    "select count(*)::integer as count from information_schema.tables where table_schema = 'public' and table_name like 'signalops_v1_%'",
  );
  assert.equal(tables.rows[0].count, 13);

  const subjectColumn = await client.query(
    `select is_nullable
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'signalops_v1_events'
       and column_name = 'subject'`,
  );
  assert.deepEqual(subjectColumn.rows, [{ is_nullable: "NO" }]);
  const subjectIndex = await client.query(
    `select indexname
     from pg_indexes
     where schemaname = 'public'
       and tablename = 'signalops_v1_events'
       and indexname = 'signalops_v1_events_tenant_subject_time_idx'`,
  );
  assert.equal(subjectIndex.rowCount, 1);

  const privileges = await client.query(
    `select
      has_table_privilege('anon', 'public.signalops_v1_events', 'select') as anon_events,
      has_table_privilege('authenticated', 'public.signalops_v1_incidents', 'select') as user_incidents,
      has_table_privilege('authenticated', 'public.signalops_v1_slo_policies', 'select') as user_slos,
      has_table_privilege('authenticated', 'public.signalops_v1_incident_transitions', 'select') as user_history,
      has_table_privilege('service_role', 'public.signalops_v1_slo_policies', 'update') as service_slos,
      has_function_privilege(
        'service_role',
        'public.signalops_v1_persist_incident_transition(jsonb,jsonb)',
        'execute'
      ) as service_incident_transition,
      has_function_privilege(
        'authenticated',
        'public.signalops_v1_persist_incident_transition(jsonb,jsonb)',
        'execute'
      ) as user_incident_transition,
      has_function_privilege(
        'service_role',
        'public.signalops_v1_apply_retention(timestamptz,timestamptz,timestamptz,timestamptz)',
        'execute'
      ) as service_retention`,
  );
  assert.deepEqual(privileges.rows[0], {
    anon_events: false,
    user_incidents: false,
    user_slos: false,
    user_history: false,
    service_slos: true,
    service_incident_transition: true,
    user_incident_transition: false,
    service_retention: true,
  });

  const rowSecurity = await client.query(
    `select relname, relrowsecurity
     from pg_class
     where oid in (
       'public.signalops_v1_slo_policies'::regclass,
       'public.signalops_v1_incident_transitions'::regclass
     )
     order by relname`,
  );
  assert.deepEqual(rowSecurity.rows, [
    { relname: "signalops_v1_incident_transitions", relrowsecurity: true },
    { relname: "signalops_v1_slo_policies", relrowsecurity: true },
  ]);

  await client.query(
    "insert into public.signalops_v1_tenants(id, name) values ($1, 'SQL Test')",
    [tenantId],
  );
  await client.query(
    `insert into public.signalops_v1_events(
      tenant_id, event_id, event_type, event_time, subject, payload, payload_digest, received_at
    ) values
      ($1, 'evt-old', 'com.signalops.ai.operation.accepted.v1', now() - interval '200 days', 'operation/sql-old', jsonb_build_object('subject', 'operation/sql-old'), repeat('a', 64), now() - interval '200 days'),
      ($1, 'evt-new', 'com.signalops.ai.operation.accepted.v1', now(), 'operation/sql-new', jsonb_build_object('subject', 'operation/sql-new'), repeat('b', 64), now())`,
    [tenantId],
  );

  const subjectScoped = await client.query(
    `select event_id
     from public.signalops_v1_events
     where tenant_id = $1 and subject = 'operation/sql-new'`,
    [tenantId],
  );
  assert.deepEqual(subjectScoped.rows, [{ event_id: "evt-new" }]);

  await client.query("set role service_role");
  try {
    const updated = await client.query(
      "update public.signalops_v1_tenants set name = 'SQL Test Updated' where id = $1",
      [tenantId],
    );
    assert.equal(updated.rowCount, 1);

    const first = await client.query(
      "select allowed, remaining from public.signalops_v1_consume_rate_limit($1, 2, 60)",
      [bucketKey],
    );
    const second = await client.query(
      "select allowed, remaining from public.signalops_v1_consume_rate_limit($1, 2, 60)",
      [bucketKey],
    );
    const third = await client.query(
      "select allowed, remaining from public.signalops_v1_consume_rate_limit($1, 2, 60)",
      [bucketKey],
    );
    assert.deepEqual(first.rows[0], { allowed: true, remaining: 1 });
    assert.deepEqual(second.rows[0], { allowed: true, remaining: 0 });
    assert.deepEqual(third.rows[0], { allowed: false, remaining: 0 });

    await client.query(
      `insert into public.signalops_v1_slo_policies(
        tenant_id, id, version, name, description, metric, comparator, objective,
        warning_threshold, critical_threshold, minimum_sample, window_minutes, enabled, updated_by
      ) values (
        $1, 'slo_sql_reliability', 'sql-v1', 'SQL reliability', 'Migration constraint check.',
        'operation_success_rate', 'gte', 0.99, 0.98, 0.95, 20, 1440, true, 'sql:test'
      )`,
      [tenantId],
    );
    const incidentTime = "2026-08-24T01:00:00.000Z";
    const incidentPayload = JSON.stringify({
      tenant_id: tenantId,
      id: "inc_aaaaaaaaaaaaaaaaaaaaaaaa",
      fingerprint: "c".repeat(64),
      state: "acknowledged",
      severity: "critical",
      metric: "slo:operation_success_rate",
      provider_key: null,
      model_key: null,
      policy_version: "sql-v1",
      title: "SQL incident",
      evidence: {},
      opened_at: incidentTime,
      last_observed_at: incidentTime,
      resolved_at: null,
      acknowledged_at: incidentTime,
      acknowledged_by: "sql:test",
      acknowledgement_note: "investigating",
      alert_version: 1,
    });
    const transitionPayload = JSON.stringify({
      tenant_id: tenantId,
      id: "trn_bbbbbbbbbbbbbbbbbbbbbbbb",
      incident_id: "inc_aaaaaaaaaaaaaaaaaaaaaaaa",
      transition_type: "acknowledged",
      actor_subject: "sql:test",
      from_state: "open",
      to_state: "acknowledged",
      from_severity: "critical",
      to_severity: "critical",
      alert_version: 1,
      evidence: {},
      created_at: incidentTime,
    });
    for (let retry = 0; retry < 2; retry += 1) {
      await client.query(
        "select public.signalops_v1_persist_incident_transition($1::jsonb, $2::jsonb)",
        [incidentPayload, transitionPayload],
      );
    }
    const workflow = await client.query(
      `select incidents.state, count(transitions.id)::integer as transitions
       from public.signalops_v1_incidents as incidents
       left join public.signalops_v1_incident_transitions as transitions
         on transitions.tenant_id = incidents.tenant_id and transitions.incident_id = incidents.id
       where incidents.tenant_id = $1 and incidents.id = 'inc_aaaaaaaaaaaaaaaaaaaaaaaa'
       group by incidents.state`,
      [tenantId],
    );
    assert.deepEqual(workflow.rows, [{ state: "acknowledged", transitions: 1 }]);

    const watermark = await client.query(
      "select event_count::integer, event_id from public.signalops_v1_event_watermark($1, now() - interval '1 day')",
      [tenantId],
    );
    assert.deepEqual(watermark.rows[0], { event_count: 1, event_id: "evt-new" });

    const retention = await client.query(
      `select events_deleted::integer
       from public.signalops_v1_apply_retention(
         now() - interval '100 days',
         now() - interval '400 days',
         now() - interval '400 days',
         now() - interval '2 days'
       )`,
    );
    assert.equal(retention.rows[0].events_deleted, 1);
  } finally {
    await client.query("reset role");
  }

  const retained = await client.query(
    "select event_id from public.signalops_v1_events where tenant_id = $1 order by event_id",
    [tenantId],
  );
  assert.deepEqual(retained.rows, [{ event_id: "evt-new" }]);
} finally {
  try {
    await client.query("reset role");
    const cleanupTargets = await client.query(
      `select
        to_regclass('public.signalops_v1_tenants') is not null as tenants,
        to_regclass('public.signalops_v1_rate_limit_buckets') is not null as rate_limits`,
    );
    if (cleanupTargets.rows[0].tenants) {
      await client.query("delete from public.signalops_v1_tenants where id = $1", [tenantId]);
    }
    if (cleanupTargets.rows[0].rate_limits) {
      await client.query(
        "delete from public.signalops_v1_rate_limit_buckets where bucket_key = $1",
        [bucketKey],
      );
    }
  } finally {
    await client.end();
  }
}

console.log("signalops PostgreSQL migrations and RPC checks passed");

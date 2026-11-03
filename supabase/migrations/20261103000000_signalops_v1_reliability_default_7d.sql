-- Operation reliability default: 50 operations over a rolling 7-day window.
-- The code default in src/lib/signalops/v1/slo.ts already uses 50 / 10,080 under policy
-- version operation-reliability-7d-2026-10-27, but rows materialized by 20260824011500 and
-- 20260824050000 still hold the original 20 / 1,440, and stored rows override the code
-- fallback at read time. Match the persisted default to the shipped one, including the
-- version label: incident identity is (tenant, metric, route scope, policy version), so
-- migrating 20/24h rows to the 50/7d rule under the old version would let incident sync
-- reuse the old incident and mute the opening alert for the revised rule. The new version
-- gives the revised rule its own incident lifecycle. Only untouched legacy default rows are
-- updated: a tenant change via PATCH /v1/slos rewrites the policy version to
-- tenant-policy-*, so the version-scoped predicate preserves tenant-customized values. The
-- provisioning function is replaced so new tenants are materialized with the shipped
-- default and version too. This is a system default correction, not an operator policy
-- change: no audit event.

update public.signalops_v1_slo_policies
set version = 'operation-reliability-7d-2026-10-27',
    minimum_sample = 50,
    window_minutes = 10080
where id = 'slo_operation_success_rate'
  and version = 'operation-reliability-2026-08-24'
  and minimum_sample = 20
  and window_minutes = 1440;

create or replace function public.signalops_v1_provision_workspace(
  p_tenant_id text,
  p_tenant_name text,
  p_subject text,
  p_request_id text
)
returns table (tenant_id text, tenant_name text, role text, created boolean)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  existing_tenant_id text;
  existing_tenant_name text;
  existing_role text;
begin
  if p_tenant_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$' then
    raise exception 'invalid tenant id';
  end if;
  if char_length(btrim(p_tenant_name)) < 2 or char_length(btrim(p_tenant_name)) > 120 then
    raise exception 'invalid tenant name';
  end if;
  if p_subject !~ '^[A-Za-z0-9][A-Za-z0-9._:/|-]{0,199}$' then
    raise exception 'invalid subject';
  end if;
  if p_request_id !~ '^req_[A-Za-z0-9_-]{8,116}$' then
    raise exception 'invalid request id';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('signalops:self-serve:' || p_subject, 0));

  select tenants.id, tenants.name, memberships.role
    into existing_tenant_id, existing_tenant_name, existing_role
  from public.signalops_v1_operator_memberships as memberships
  join public.signalops_v1_tenants as tenants on tenants.id = memberships.tenant_id
  where memberships.subject = p_subject and tenants.status = 'active'
  order by memberships.created_at asc, memberships.tenant_id asc
  limit 1;

  if existing_tenant_id is not null then
    return query select existing_tenant_id, existing_tenant_name, existing_role, false;
    return;
  end if;

  insert into public.signalops_v1_tenants (id, name, status)
  values (p_tenant_id, btrim(p_tenant_name), 'active');

  insert into public.signalops_v1_operator_memberships (tenant_id, subject, role)
  values (p_tenant_id, p_subject, 'owner');

  insert into public.signalops_v1_slo_policies (
    tenant_id,
    id,
    version,
    name,
    description,
    metric,
    comparator,
    objective,
    warning_threshold,
    critical_threshold,
    minimum_sample,
    window_minutes,
    enabled,
    updated_by
  )
  select
    p_tenant_id,
    policy.id,
    policy.version,
    policy.name,
    policy.description,
    policy.metric,
    policy.comparator,
    policy.objective,
    policy.warning_threshold,
    policy.critical_threshold,
    policy.minimum_sample,
    policy.window_minutes,
    policy.enabled,
    p_subject
  from (
    values
      ('slo_operation_success_rate', 'operation-reliability-7d-2026-10-27', 'Operation reliability', 'Terminal AI operations that complete successfully.', 'operation_success_rate', 'gte', 0.99::double precision, 0.98::double precision, 0.95::double precision, 50, 10080, true),
      ('slo_operation_p95_duration', 'operation-latency-2026-08-24', 'Operation latency', 'End-to-end p95 duration for terminal AI operations.', 'operation_p95_duration_ms', 'lte', 60000::double precision, 120000::double precision, 300000::double precision, 20, 1440, true),
      ('slo_provider_attempt_coverage', 'attempt-coverage-2026-08-24', 'Provider attempt coverage', 'Operations with explicit provider attempt telemetry.', 'provider_attempt_coverage', 'gte', 0.95::double precision, 0.90::double precision, 0.75::double precision, 20, 1440, true),
      ('slo_failure_classification_coverage', 'failure-taxonomy-2026-08-24', 'Failure classification coverage', 'Failed operations with a normalized failure category.', 'failure_classification_coverage', 'gte', 0.95::double precision, 0.90::double precision, 0.75::double precision, 5, 1440, true),
      ('slo_signal_freshness', 'signal-freshness-2026-08-24', 'Signal freshness', 'Time since the last received signal. Disabled until a tenant declares an expected traffic cadence.', 'signal_freshness_ms', 'lte', 300000::double precision, 900000::double precision, 3600000::double precision, 1, 60, false)
  ) as policy(
    id,
    version,
    name,
    description,
    metric,
    comparator,
    objective,
    warning_threshold,
    critical_threshold,
    minimum_sample,
    window_minutes,
    enabled
  );

  insert into public.signalops_v1_audit_log (
    tenant_id,
    actor_subject,
    action,
    target,
    request_id,
    metadata
  ) values (
    p_tenant_id,
    p_subject,
    'workspace.self_serve_created',
    'tenant:' || p_tenant_id,
    p_request_id,
    jsonb_build_object('role', 'owner')
  );

  return query select p_tenant_id, btrim(p_tenant_name), 'owner'::text, true;
end;
$$;

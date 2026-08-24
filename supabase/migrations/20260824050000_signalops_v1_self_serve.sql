create table if not exists public.signalops_v1_product_milestones (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  milestone text not null check (
    char_length(milestone) between 1 and 120
    and milestone ~ '^[a-z][a-z0-9_]*$'
  ),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  primary key (tenant_id, milestone)
);

create unique index if not exists signalops_v1_active_credential_name_idx
  on public.signalops_v1_ingest_credentials (tenant_id, lower(name))
  where revoked_at is null;

create unique index if not exists signalops_v1_active_credential_rotation_idx
  on public.signalops_v1_ingest_credentials (tenant_id, rotated_from_id)
  where revoked_at is null and rotated_from_id is not null;

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
      ('slo_operation_success_rate', 'operation-reliability-2026-08-24', 'Operation reliability', 'Terminal AI operations that complete successfully.', 'operation_success_rate', 'gte', 0.99::double precision, 0.98::double precision, 0.95::double precision, 20, 1440, true),
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

create or replace function public.signalops_v1_create_ingest_credential(
  p_tenant_id text,
  p_subject text,
  p_name text,
  p_token_prefix text,
  p_token_hash text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_rotated_from_id uuid,
  p_request_id text
)
returns table (
  id uuid,
  tenant_id text,
  name text,
  token_prefix text,
  scopes text[],
  created_at timestamptz,
  expires_at timestamptz,
  rotated_from_id uuid,
  revoked_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.signalops_v1_operator_memberships as memberships
    join public.signalops_v1_tenants as tenants on tenants.id = memberships.tenant_id
    where memberships.tenant_id = p_tenant_id
      and memberships.subject = p_subject
      and memberships.role = 'owner'
      and tenants.status = 'active'
  ) then
    raise exception 'active owner membership required';
  end if;
  if char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 120 then
    raise exception 'invalid credential name';
  end if;
  if p_token_prefix !~ '^sop_live_[A-Za-z0-9_-]{0,15}$' then
    raise exception 'invalid token prefix';
  end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid token hash';
  end if;
  if cardinality(p_scopes) < 1
    or not p_scopes <@ array['events:validate', 'events:write']::text[] then
    raise exception 'invalid credential scopes';
  end if;
  if p_expires_at is not null
    and (p_expires_at <= clock_timestamp() or p_expires_at > clock_timestamp() + interval '366 days') then
    raise exception 'invalid credential expiry';
  end if;
  if p_rotated_from_id is not null and not exists (
    select 1
    from public.signalops_v1_ingest_credentials as source_credentials
    where source_credentials.id = p_rotated_from_id
      and source_credentials.tenant_id = p_tenant_id
      and source_credentials.revoked_at is null
      and (
        source_credentials.expires_at is null
        or source_credentials.expires_at > clock_timestamp()
      )
  ) then
    raise exception 'active source credential required';
  end if;

  return query
  with inserted as (
    insert into public.signalops_v1_ingest_credentials (
      tenant_id,
      name,
      token_prefix,
      token_hash,
      scopes,
      expires_at,
      rotated_from_id
    ) values (
      p_tenant_id,
      btrim(p_name),
      p_token_prefix,
      p_token_hash,
      p_scopes,
      p_expires_at,
      p_rotated_from_id
    )
    returning
      signalops_v1_ingest_credentials.id,
      signalops_v1_ingest_credentials.tenant_id,
      signalops_v1_ingest_credentials.name,
      signalops_v1_ingest_credentials.token_prefix,
      signalops_v1_ingest_credentials.scopes,
      signalops_v1_ingest_credentials.created_at,
      signalops_v1_ingest_credentials.expires_at,
      signalops_v1_ingest_credentials.rotated_from_id,
      signalops_v1_ingest_credentials.revoked_at
  ), audited as (
    insert into public.signalops_v1_audit_log (
      tenant_id,
      actor_subject,
      action,
      target,
      request_id,
      metadata
    )
    select
      p_tenant_id,
      p_subject,
      case when p_rotated_from_id is null then 'credential.self_serve_created' else 'credential.self_serve_rotated' end,
      'credential:' || inserted.id::text,
      p_request_id,
      jsonb_build_object(
        'scopes', array_to_string(p_scopes, ','),
        'expiresAt', coalesce(p_expires_at::text, 'none'),
        'rotation', p_rotated_from_id is not null
      )
    from inserted
  )
  select * from inserted;
end;
$$;

create or replace function public.signalops_v1_revoke_ingest_credential(
  p_tenant_id text,
  p_subject text,
  p_credential_id uuid,
  p_request_id text
)
returns table (id uuid, revoked_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.signalops_v1_operator_memberships as memberships
    join public.signalops_v1_tenants as tenants on tenants.id = memberships.tenant_id
    where memberships.tenant_id = p_tenant_id
      and memberships.subject = p_subject
      and memberships.role = 'owner'
      and tenants.status = 'active'
  ) then
    raise exception 'active owner membership required';
  end if;

  return query
  with revoked as (
    update public.signalops_v1_ingest_credentials as credentials
    set revoked_at = clock_timestamp()
    where credentials.id = p_credential_id
      and credentials.tenant_id = p_tenant_id
      and credentials.revoked_at is null
    returning credentials.id, credentials.revoked_at
  ), audited as (
    insert into public.signalops_v1_audit_log (
      tenant_id,
      actor_subject,
      action,
      target,
      request_id,
      metadata
    )
    select
      p_tenant_id,
      p_subject,
      'credential.self_serve_revoked',
      'credential:' || revoked.id::text,
      p_request_id,
      '{}'::jsonb
    from revoked
  )
  select * from revoked;
end;
$$;

create or replace function public.signalops_v1_rotate_ingest_credential(
  p_tenant_id text,
  p_subject text,
  p_source_credential_id uuid,
  p_name text,
  p_token_prefix text,
  p_token_hash text,
  p_scopes text[],
  p_expires_at timestamptz,
  p_request_id text
)
returns table (
  id uuid,
  tenant_id text,
  name text,
  token_prefix text,
  scopes text[],
  created_at timestamptz,
  expires_at timestamptz,
  rotated_from_id uuid,
  revoked_at timestamptz
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  source_name text;
begin
  if not exists (
    select 1
    from public.signalops_v1_operator_memberships as memberships
    join public.signalops_v1_tenants as tenants on tenants.id = memberships.tenant_id
    where memberships.tenant_id = p_tenant_id
      and memberships.subject = p_subject
      and memberships.role = 'owner'
      and tenants.status = 'active'
  ) then
    raise exception 'active owner membership required';
  end if;

  select credentials.name
    into source_name
  from public.signalops_v1_ingest_credentials as credentials
  where credentials.id = p_source_credential_id
    and credentials.tenant_id = p_tenant_id
    and credentials.revoked_at is null
    and (credentials.expires_at is null or credentials.expires_at > clock_timestamp())
  for update;
  if source_name is null then
    raise exception 'active source credential required';
  end if;

  return query
  select created.*
  from public.signalops_v1_create_ingest_credential(
    p_tenant_id,
    p_subject,
    p_name,
    p_token_prefix,
    p_token_hash,
    p_scopes,
    p_expires_at,
    p_source_credential_id,
    p_request_id
  ) as created;

  update public.signalops_v1_ingest_credentials as credentials
  set revoked_at = clock_timestamp()
  where credentials.id = p_source_credential_id
    and credentials.tenant_id = p_tenant_id
    and credentials.revoked_at is null;
  if not found then
    raise exception 'active source credential required';
  end if;
end;
$$;

create or replace function public.signalops_v1_claim_product_milestone(
  p_tenant_id text,
  p_milestone text,
  p_metadata jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer;
begin
  if p_milestone !~ '^[a-z][a-z0-9_]{0,119}$' then
    raise exception 'invalid milestone';
  end if;
  if jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 4096 then
    raise exception 'invalid milestone metadata';
  end if;

  insert into public.signalops_v1_product_milestones (tenant_id, milestone, metadata)
  values (p_tenant_id, p_milestone, p_metadata)
  on conflict (tenant_id, milestone) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count = 1;
end;
$$;

alter table public.signalops_v1_product_milestones enable row level security;

drop policy if exists signalops_v1_product_milestones_deny_client_access
  on public.signalops_v1_product_milestones;
create policy signalops_v1_product_milestones_deny_client_access
  on public.signalops_v1_product_milestones
  for all to anon, authenticated
  using (false)
  with check (false);

revoke all on public.signalops_v1_product_milestones from anon, authenticated;
grant select, insert on public.signalops_v1_product_milestones to service_role;

revoke all on function public.signalops_v1_provision_workspace(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.signalops_v1_create_ingest_credential(text, text, text, text, text, text[], timestamptz, uuid, text)
  from public, anon, authenticated;
revoke all on function public.signalops_v1_revoke_ingest_credential(text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.signalops_v1_rotate_ingest_credential(text, text, uuid, text, text, text, text[], timestamptz, text)
  from public, anon, authenticated;
revoke all on function public.signalops_v1_claim_product_milestone(text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.signalops_v1_provision_workspace(text, text, text, text)
  to service_role;
grant execute on function public.signalops_v1_create_ingest_credential(text, text, text, text, text, text[], timestamptz, uuid, text)
  to service_role;
grant execute on function public.signalops_v1_revoke_ingest_credential(text, text, uuid, text)
  to service_role;
grant execute on function public.signalops_v1_rotate_ingest_credential(text, text, uuid, text, text, text, text[], timestamptz, text)
  to service_role;
grant execute on function public.signalops_v1_claim_product_milestone(text, text, jsonb)
  to service_role;

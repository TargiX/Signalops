alter table public.signalops_v1_tenants
  add column if not exists status text not null default 'active'
    check (status in ('active', 'suspended', 'closed'));

alter table public.signalops_v1_tenants
  add column if not exists updated_at timestamptz not null default now();

alter table public.signalops_v1_ingest_credentials
  add column if not exists expires_at timestamptz;

alter table public.signalops_v1_ingest_credentials
  add column if not exists rotated_from_id uuid
    references public.signalops_v1_ingest_credentials(id) on delete set null;

alter table public.signalops_v1_operator_memberships
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.signalops_v1_projection_snapshots (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  range_key text not null check (range_key in ('24h', '7d', '30d', '90d')),
  checkpoint_received_at timestamptz,
  checkpoint_event_id text,
  source_event_count integer not null check (source_event_count >= 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  projected_at timestamptz not null default now(),
  primary key (tenant_id, range_key)
);

create table if not exists public.signalops_v1_projection_checkpoints (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  projector text not null check (char_length(projector) between 1 and 120),
  last_received_at timestamptz,
  last_event_id text,
  source_event_count bigint not null default 0 check (source_event_count >= 0),
  source_digest char(64),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, projector)
);

create table if not exists public.signalops_v1_telemetry_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  event_id text not null check (char_length(event_id) between 1 and 160),
  conflict_kind text not null check (
    conflict_kind in ('idempotency_payload', 'contradictory_terminal', 'identity_collision')
  ),
  existing_digest char(64),
  observed_digest char(64),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  detected_at timestamptz not null default now(),
  unique (tenant_id, event_id, conflict_kind, observed_digest)
);

create table if not exists public.signalops_v1_incidents (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  id text not null check (char_length(id) between 1 and 160),
  fingerprint char(64) not null,
  state text not null check (state in ('open', 'resolved')),
  severity text not null check (severity in ('warning', 'critical')),
  metric text not null check (char_length(metric) between 1 and 120),
  provider_key text,
  model_key text,
  policy_version text not null check (char_length(policy_version) between 1 and 64),
  title text not null check (char_length(title) between 1 and 240),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  opened_at timestamptz not null,
  last_observed_at timestamptz not null,
  resolved_at timestamptz,
  alert_version integer not null default 1 check (alert_version > 0),
  primary key (tenant_id, id),
  unique (tenant_id, fingerprint)
);

create table if not exists public.signalops_v1_alert_deliveries (
  tenant_id text not null,
  incident_id text not null,
  alert_version integer not null check (alert_version > 0),
  status text not null check (status in ('pending', 'delivered', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error_code text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (tenant_id, incident_id, alert_version),
  foreign key (tenant_id, incident_id)
    references public.signalops_v1_incidents(tenant_id, id) on delete cascade
);

create table if not exists public.signalops_v1_audit_log (
  id bigint generated always as identity primary key,
  tenant_id text references public.signalops_v1_tenants(id) on delete set null,
  actor_subject text not null check (char_length(actor_subject) between 1 and 200),
  action text not null check (char_length(action) between 1 and 120),
  target text check (target is null or char_length(target) between 1 and 200),
  request_id text check (request_id is null or char_length(request_id) between 1 and 120),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table if not exists public.signalops_v1_rate_limit_buckets (
  bucket_key char(64) not null,
  window_start timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null default now(),
  primary key (bucket_key, window_start)
);

create index if not exists signalops_v1_events_tenant_type_time_idx
  on public.signalops_v1_events (tenant_id, event_type, event_time desc);

create index if not exists signalops_v1_events_tenant_received_idx
  on public.signalops_v1_events (tenant_id, received_at desc, event_id desc);

create index if not exists signalops_v1_conflicts_tenant_detected_idx
  on public.signalops_v1_telemetry_conflicts (tenant_id, detected_at desc);

create index if not exists signalops_v1_incidents_tenant_state_idx
  on public.signalops_v1_incidents (tenant_id, state, last_observed_at desc);

create index if not exists signalops_v1_audit_tenant_created_idx
  on public.signalops_v1_audit_log (tenant_id, created_at desc);

create index if not exists signalops_v1_rate_limit_updated_idx
  on public.signalops_v1_rate_limit_buckets (updated_at);

create or replace function public.signalops_v1_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.signalops_v1_touch_updated_at()
  from public, anon, authenticated;

drop trigger if exists signalops_v1_tenants_touch_updated_at on public.signalops_v1_tenants;
create trigger signalops_v1_tenants_touch_updated_at
before update on public.signalops_v1_tenants
for each row execute function public.signalops_v1_touch_updated_at();

drop trigger if exists signalops_v1_memberships_touch_updated_at
  on public.signalops_v1_operator_memberships;
create trigger signalops_v1_memberships_touch_updated_at
before update on public.signalops_v1_operator_memberships
for each row execute function public.signalops_v1_touch_updated_at();

create or replace function public.signalops_v1_consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := clock_timestamp();
  bucket_start timestamptz;
  bucket_count integer;
begin
  if p_bucket_key !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate-limit bucket key';
  end if;
  if p_limit < 1 or p_limit > 100000 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit policy';
  end if;

  bucket_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.signalops_v1_rate_limit_buckets (
    bucket_key,
    window_start,
    request_count,
    updated_at
  ) values (
    p_bucket_key,
    bucket_start,
    1,
    v_now
  )
  on conflict (bucket_key, window_start) do update
    set request_count = public.signalops_v1_rate_limit_buckets.request_count + 1,
        updated_at = excluded.updated_at
  returning request_count into bucket_count;

  return query select
    bucket_count <= p_limit,
    greatest(0, p_limit - bucket_count),
    bucket_start + make_interval(secs => p_window_seconds);
end;
$$;

revoke all on function public.signalops_v1_consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.signalops_v1_consume_rate_limit(text, integer, integer)
  to service_role;

create or replace function public.signalops_v1_event_watermark(
  p_tenant_id text,
  p_since timestamptz
)
returns table (event_count bigint, received_at timestamptz, event_id text)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  with scoped as (
    select e.received_at, e.event_id
    from public.signalops_v1_events e
    where e.tenant_id = p_tenant_id and e.event_time >= p_since
  ), latest as (
    select scoped.received_at, scoped.event_id
    from scoped
    order by scoped.received_at desc, scoped.event_id desc
    limit 1
  )
  select
    (select count(*) from scoped),
    latest.received_at,
    latest.event_id
  from latest
  union all
  select 0, null::timestamptz, null::text
  where not exists (select 1 from latest);
$$;

revoke all on function public.signalops_v1_event_watermark(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.signalops_v1_event_watermark(text, timestamptz)
  to service_role;

create or replace function public.signalops_v1_conflict_count(
  p_tenant_id text,
  p_since timestamptz
)
returns bigint
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select count(*)
  from public.signalops_v1_telemetry_conflicts
  where tenant_id = p_tenant_id and detected_at >= p_since;
$$;

revoke all on function public.signalops_v1_conflict_count(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.signalops_v1_conflict_count(text, timestamptz)
  to service_role;

create or replace function public.signalops_v1_claim_alert_delivery(
  p_tenant_id text,
  p_incident_id text,
  p_alert_version integer
)
returns table (claimed boolean, attempt_count integer)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  claimed_attempt integer;
begin
  insert into public.signalops_v1_alert_deliveries (
    tenant_id,
    incident_id,
    alert_version,
    status,
    attempt_count,
    last_attempt_at
  ) values (
    p_tenant_id,
    p_incident_id,
    p_alert_version,
    'pending',
    1,
    clock_timestamp()
  )
  on conflict (tenant_id, incident_id, alert_version) do update
    set status = 'pending',
        attempt_count = public.signalops_v1_alert_deliveries.attempt_count + 1,
        last_attempt_at = clock_timestamp()
    where public.signalops_v1_alert_deliveries.status <> 'delivered'
      and public.signalops_v1_alert_deliveries.attempt_count < 8
      and (
        public.signalops_v1_alert_deliveries.last_attempt_at is null
        or public.signalops_v1_alert_deliveries.last_attempt_at <
          clock_timestamp() - make_interval(
            secs => least(
              3600,
              (15 * power(2, public.signalops_v1_alert_deliveries.attempt_count))::integer
            )
          )
      )
  returning public.signalops_v1_alert_deliveries.attempt_count into claimed_attempt;

  return query select claimed_attempt is not null, coalesce(claimed_attempt, 0);
end;
$$;

revoke all on function public.signalops_v1_claim_alert_delivery(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.signalops_v1_claim_alert_delivery(text, text, integer)
  to service_role;

create or replace function public.signalops_v1_apply_retention(
  p_raw_before timestamptz,
  p_conflict_before timestamptz,
  p_audit_before timestamptz,
  p_rate_limit_before timestamptz
)
returns table (
  events_deleted bigint,
  conflicts_deleted bigint,
  audit_rows_deleted bigint,
  rate_limit_buckets_deleted bigint
)
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  now_at_start timestamptz := clock_timestamp();
begin
  if p_raw_before > now_at_start
    or p_conflict_before > now_at_start
    or p_audit_before > now_at_start
    or p_rate_limit_before > now_at_start then
    raise exception 'retention cutoffs cannot be in the future';
  end if;

  delete from public.signalops_v1_events where event_time < p_raw_before;
  get diagnostics events_deleted = row_count;

  delete from public.signalops_v1_telemetry_conflicts where detected_at < p_conflict_before;
  get diagnostics conflicts_deleted = row_count;

  delete from public.signalops_v1_audit_log where created_at < p_audit_before;
  get diagnostics audit_rows_deleted = row_count;

  delete from public.signalops_v1_rate_limit_buckets where updated_at < p_rate_limit_before;
  get diagnostics rate_limit_buckets_deleted = row_count;

  return next;
end;
$$;

revoke all on function public.signalops_v1_apply_retention(
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) from public, anon, authenticated;
grant execute on function public.signalops_v1_apply_retention(
  timestamptz,
  timestamptz,
  timestamptz,
  timestamptz
) to service_role;

alter table public.signalops_v1_projection_snapshots enable row level security;
alter table public.signalops_v1_projection_checkpoints enable row level security;
alter table public.signalops_v1_telemetry_conflicts enable row level security;
alter table public.signalops_v1_incidents enable row level security;
alter table public.signalops_v1_alert_deliveries enable row level security;
alter table public.signalops_v1_audit_log enable row level security;
alter table public.signalops_v1_rate_limit_buckets enable row level security;

revoke all on public.signalops_v1_projection_snapshots from anon, authenticated;
revoke all on public.signalops_v1_projection_checkpoints from anon, authenticated;
revoke all on public.signalops_v1_telemetry_conflicts from anon, authenticated;
revoke all on public.signalops_v1_incidents from anon, authenticated;
revoke all on public.signalops_v1_alert_deliveries from anon, authenticated;
revoke all on public.signalops_v1_audit_log from anon, authenticated;
revoke all on public.signalops_v1_rate_limit_buckets from anon, authenticated;

grant select, insert, update, delete on public.signalops_v1_projection_snapshots to service_role;
grant select, insert, update, delete on public.signalops_v1_projection_checkpoints to service_role;
grant select, insert on public.signalops_v1_telemetry_conflicts to service_role;
grant select, insert, update on public.signalops_v1_incidents to service_role;
grant select, insert, update on public.signalops_v1_alert_deliveries to service_role;
grant select, insert on public.signalops_v1_audit_log to service_role;
grant select, insert, update, delete on public.signalops_v1_rate_limit_buckets to service_role;
grant delete on public.signalops_v1_events to service_role;
grant delete on public.signalops_v1_telemetry_conflicts to service_role;
grant delete on public.signalops_v1_audit_log to service_role;
grant usage, select on sequence public.signalops_v1_audit_log_id_seq to service_role;

alter table public.signalops_v1_incidents
  drop constraint if exists signalops_v1_incidents_state_check;

alter table public.signalops_v1_incidents
  add constraint signalops_v1_incidents_state_check
  check (state in ('open', 'acknowledged', 'resolved'));

alter table public.signalops_v1_incidents
  add column if not exists acknowledged_at timestamptz;

alter table public.signalops_v1_incidents
  add column if not exists acknowledged_by text
    check (acknowledged_by is null or char_length(acknowledged_by) between 1 and 200);

alter table public.signalops_v1_incidents
  add column if not exists acknowledgement_note text
    check (acknowledgement_note is null or char_length(acknowledgement_note) <= 500);

create table if not exists public.signalops_v1_slo_policies (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  id text not null check (id ~ '^slo_[a-z0-9_]{3,80}$'),
  version text not null check (char_length(version) between 1 and 64),
  name text not null check (char_length(name) between 1 and 120),
  description text not null check (char_length(description) between 1 and 500),
  metric text not null check (
    metric in (
      'operation_success_rate',
      'operation_p95_duration_ms',
      'provider_attempt_coverage',
      'failure_classification_coverage',
      'signal_freshness_ms'
    )
  ),
  comparator text not null check (comparator in ('gte', 'lte')),
  objective double precision not null check (objective >= 0 and objective <= 31536000000),
  warning_threshold double precision not null
    check (warning_threshold >= 0 and warning_threshold <= 31536000000),
  critical_threshold double precision not null
    check (critical_threshold >= 0 and critical_threshold <= 31536000000),
  minimum_sample integer not null check (minimum_sample between 1 and 1000000),
  window_minutes integer not null check (window_minutes between 1 and 129600),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text check (updated_by is null or char_length(updated_by) between 1 and 200),
  primary key (tenant_id, id),
  check (
    (comparator = 'gte' and critical_threshold <= warning_threshold and warning_threshold <= objective)
    or
    (comparator = 'lte' and objective <= warning_threshold and warning_threshold <= critical_threshold)
  ),
  check (
    metric not in (
      'operation_success_rate',
      'provider_attempt_coverage',
      'failure_classification_coverage'
    )
    or (objective <= 1 and warning_threshold <= 1 and critical_threshold <= 1)
  )
);

create table if not exists public.signalops_v1_incident_transitions (
  tenant_id text not null,
  id text not null check (id ~ '^trn_[a-f0-9]{24}$'),
  incident_id text not null,
  transition_type text not null check (
    transition_type in (
      'opened',
      'reopened',
      'escalated',
      'deescalated',
      'acknowledged',
      'unacknowledged',
      'resolved'
    )
  ),
  actor_subject text not null check (char_length(actor_subject) between 1 and 200),
  from_state text check (from_state is null or from_state in ('open', 'acknowledged', 'resolved')),
  to_state text not null check (to_state in ('open', 'acknowledged', 'resolved')),
  from_severity text check (from_severity is null or from_severity in ('warning', 'critical')),
  to_severity text not null check (to_severity in ('warning', 'critical')),
  alert_version integer not null check (alert_version > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id, incident_id)
    references public.signalops_v1_incidents(tenant_id, id) on delete cascade
);

create index if not exists signalops_v1_incident_transitions_tenant_incident_idx
  on public.signalops_v1_incident_transitions (tenant_id, incident_id, created_at asc);

create index if not exists signalops_v1_slo_policies_tenant_enabled_idx
  on public.signalops_v1_slo_policies (tenant_id, enabled, id);

create or replace function public.signalops_v1_persist_incident_transition(
  p_incident jsonb,
  p_transition jsonb
)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if jsonb_typeof(p_incident) is distinct from 'object'
    or jsonb_typeof(p_transition) is distinct from 'object' then
    raise exception 'incident and transition must be objects';
  end if;
  if p_incident->>'tenant_id' is distinct from p_transition->>'tenant_id'
    or p_incident->>'id' is distinct from p_transition->>'incident_id' then
    raise exception 'incident transition identity mismatch';
  end if;

  insert into public.signalops_v1_incidents (
    tenant_id,
    id,
    fingerprint,
    state,
    severity,
    metric,
    provider_key,
    model_key,
    policy_version,
    title,
    evidence,
    opened_at,
    last_observed_at,
    resolved_at,
    acknowledged_at,
    acknowledged_by,
    acknowledgement_note,
    alert_version
  ) values (
    p_incident->>'tenant_id',
    p_incident->>'id',
    p_incident->>'fingerprint',
    p_incident->>'state',
    p_incident->>'severity',
    p_incident->>'metric',
    p_incident->>'provider_key',
    p_incident->>'model_key',
    p_incident->>'policy_version',
    p_incident->>'title',
    coalesce(p_incident->'evidence', '{}'::jsonb),
    (p_incident->>'opened_at')::timestamptz,
    (p_incident->>'last_observed_at')::timestamptz,
    (p_incident->>'resolved_at')::timestamptz,
    (p_incident->>'acknowledged_at')::timestamptz,
    p_incident->>'acknowledged_by',
    p_incident->>'acknowledgement_note',
    (p_incident->>'alert_version')::integer
  )
  on conflict (tenant_id, id) do update set
    fingerprint = excluded.fingerprint,
    state = excluded.state,
    severity = excluded.severity,
    metric = excluded.metric,
    provider_key = excluded.provider_key,
    model_key = excluded.model_key,
    policy_version = excluded.policy_version,
    title = excluded.title,
    evidence = excluded.evidence,
    opened_at = excluded.opened_at,
    last_observed_at = excluded.last_observed_at,
    resolved_at = excluded.resolved_at,
    acknowledged_at = excluded.acknowledged_at,
    acknowledged_by = excluded.acknowledged_by,
    acknowledgement_note = excluded.acknowledgement_note,
    alert_version = excluded.alert_version;

  insert into public.signalops_v1_incident_transitions (
    tenant_id,
    id,
    incident_id,
    transition_type,
    actor_subject,
    from_state,
    to_state,
    from_severity,
    to_severity,
    alert_version,
    evidence,
    created_at
  ) values (
    p_transition->>'tenant_id',
    p_transition->>'id',
    p_transition->>'incident_id',
    p_transition->>'transition_type',
    p_transition->>'actor_subject',
    p_transition->>'from_state',
    p_transition->>'to_state',
    p_transition->>'from_severity',
    p_transition->>'to_severity',
    (p_transition->>'alert_version')::integer,
    coalesce(p_transition->'evidence', '{}'::jsonb),
    (p_transition->>'created_at')::timestamptz
  )
  on conflict (tenant_id, id) do nothing;
end;
$$;

revoke all on function public.signalops_v1_persist_incident_transition(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.signalops_v1_persist_incident_transition(jsonb, jsonb)
  to service_role;

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
  tenants.id,
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
  'system:default-policy'
from public.signalops_v1_tenants as tenants
cross join (
  values
    (
      'slo_operation_success_rate',
      'operation-reliability-2026-08-24',
      'Operation reliability',
      'Terminal AI operations that complete successfully.',
      'operation_success_rate',
      'gte',
      0.99::double precision,
      0.98::double precision,
      0.95::double precision,
      20,
      1440,
      true
    ),
    (
      'slo_operation_p95_duration',
      'operation-latency-2026-08-24',
      'Operation latency',
      'End-to-end p95 duration for terminal AI operations.',
      'operation_p95_duration_ms',
      'lte',
      60000::double precision,
      120000::double precision,
      300000::double precision,
      20,
      1440,
      true
    ),
    (
      'slo_provider_attempt_coverage',
      'attempt-coverage-2026-08-24',
      'Provider attempt coverage',
      'Operations with explicit provider attempt telemetry.',
      'provider_attempt_coverage',
      'gte',
      0.95::double precision,
      0.90::double precision,
      0.75::double precision,
      20,
      1440,
      true
    ),
    (
      'slo_failure_classification_coverage',
      'failure-taxonomy-2026-08-24',
      'Failure classification coverage',
      'Failed operations with a normalized failure category.',
      'failure_classification_coverage',
      'gte',
      0.95::double precision,
      0.90::double precision,
      0.75::double precision,
      5,
      1440,
      true
    ),
    (
      'slo_signal_freshness',
      'signal-freshness-2026-08-24',
      'Signal freshness',
      'Time since the last received signal. Disabled until a tenant declares an expected traffic cadence.',
      'signal_freshness_ms',
      'lte',
      300000::double precision,
      900000::double precision,
      3600000::double precision,
      1,
      60,
      false
    )
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
)
where tenants.status = 'active'
on conflict (tenant_id, id) do nothing;

alter table public.signalops_v1_slo_policies enable row level security;
alter table public.signalops_v1_incident_transitions enable row level security;

drop policy if exists signalops_v1_slo_policies_deny_client_access
  on public.signalops_v1_slo_policies;
create policy signalops_v1_slo_policies_deny_client_access
  on public.signalops_v1_slo_policies
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists signalops_v1_incident_transitions_deny_client_access
  on public.signalops_v1_incident_transitions;
create policy signalops_v1_incident_transitions_deny_client_access
  on public.signalops_v1_incident_transitions
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on public.signalops_v1_slo_policies from anon, authenticated;
revoke all on public.signalops_v1_incident_transitions from anon, authenticated;

grant select, insert, update on public.signalops_v1_slo_policies to service_role;
grant select, insert on public.signalops_v1_incident_transitions to service_role;

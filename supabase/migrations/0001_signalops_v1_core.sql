create extension if not exists pgcrypto;

create table if not exists public.signalops_v1_tenants (
  id text primary key check (id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$'),
  name text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now()
);

create table if not exists public.signalops_v1_ingest_credentials (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  token_prefix text not null check (char_length(token_prefix) between 6 and 24),
  token_hash char(64) not null unique,
  scopes text[] not null default array['events:validate', 'events:write'],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint signalops_v1_ingest_scopes_check
    check (scopes <@ array['events:validate', 'events:write']::text[])
);

create table if not exists public.signalops_v1_operator_memberships (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 200),
  role text not null default 'operator' check (role in ('owner', 'operator', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, subject)
);

create table if not exists public.signalops_v1_events (
  tenant_id text not null references public.signalops_v1_tenants(id) on delete cascade,
  event_id text not null check (char_length(event_id) between 1 and 160),
  event_type text not null,
  event_time timestamptz not null,
  payload jsonb not null,
  payload_digest char(64) not null,
  received_at timestamptz not null default now(),
  primary key (tenant_id, event_id)
);

create index if not exists signalops_v1_events_tenant_time_idx
  on public.signalops_v1_events (tenant_id, event_time desc);

alter table public.signalops_v1_tenants enable row level security;
alter table public.signalops_v1_ingest_credentials enable row level security;
alter table public.signalops_v1_operator_memberships enable row level security;
alter table public.signalops_v1_events enable row level security;

revoke all on public.signalops_v1_tenants from anon, authenticated;
revoke all on public.signalops_v1_ingest_credentials from anon, authenticated;
revoke all on public.signalops_v1_operator_memberships from anon, authenticated;
revoke all on public.signalops_v1_events from anon, authenticated;

grant select, insert, update, delete on public.signalops_v1_tenants to service_role;
grant select, insert, update, delete on public.signalops_v1_ingest_credentials to service_role;
grant select, insert, update, delete on public.signalops_v1_operator_memberships to service_role;
grant select, insert on public.signalops_v1_events to service_role;

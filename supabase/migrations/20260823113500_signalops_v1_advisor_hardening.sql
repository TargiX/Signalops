create index if not exists signalops_v1_ingest_credentials_tenant_idx
  on public.signalops_v1_ingest_credentials (tenant_id);

create index if not exists signalops_v1_ingest_credentials_rotated_from_idx
  on public.signalops_v1_ingest_credentials (rotated_from_id)
  where rotated_from_id is not null;

-- SignalOps is server-mediated. Browser roles have no table grants, and these explicit
-- deny policies keep that boundary visible to both operators and database advisors.
create policy signalops_v1_tenants_deny_client_access
  on public.signalops_v1_tenants
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_ingest_credentials_deny_client_access
  on public.signalops_v1_ingest_credentials
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_operator_memberships_deny_client_access
  on public.signalops_v1_operator_memberships
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_events_deny_client_access
  on public.signalops_v1_events
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_projection_snapshots_deny_client_access
  on public.signalops_v1_projection_snapshots
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_projection_checkpoints_deny_client_access
  on public.signalops_v1_projection_checkpoints
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_telemetry_conflicts_deny_client_access
  on public.signalops_v1_telemetry_conflicts
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_incidents_deny_client_access
  on public.signalops_v1_incidents
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_alert_deliveries_deny_client_access
  on public.signalops_v1_alert_deliveries
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_audit_log_deny_client_access
  on public.signalops_v1_audit_log
  for all to anon, authenticated
  using (false)
  with check (false);

create policy signalops_v1_rate_limit_buckets_deny_client_access
  on public.signalops_v1_rate_limit_buckets
  for all to anon, authenticated
  using (false)
  with check (false);

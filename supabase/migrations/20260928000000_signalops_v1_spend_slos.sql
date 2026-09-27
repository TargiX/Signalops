-- Spend-truth SLOs: cost evidence coverage and billing reconciliation delta.
-- The metric column is an enumerated CHECK; extend it name-independently so the
-- migration does not depend on postgres' auto-generated constraint names.

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.signalops_v1_slo_policies'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%operation_success_rate%'
  loop
    execute format(
      'alter table public.signalops_v1_slo_policies drop constraint %I',
      constraint_record.conname
    );
  end loop;
end $$;

alter table public.signalops_v1_slo_policies
  add constraint signalops_v1_slo_policies_metric_check check (
    metric in (
      'operation_success_rate',
      'operation_p95_duration_ms',
      'provider_attempt_coverage',
      'failure_classification_coverage',
      'signal_freshness_ms',
      'cost_evidence_coverage',
      'reconciliation_delta_ratio'
    )
  ),
  add constraint signalops_v1_slo_policies_ratio_bounds_check check (
    metric not in (
      'operation_success_rate',
      'provider_attempt_coverage',
      'failure_classification_coverage',
      'cost_evidence_coverage',
      'reconciliation_delta_ratio'
    )
    or (objective <= 1 and warning_threshold <= 1 and critical_threshold <= 1)
  );

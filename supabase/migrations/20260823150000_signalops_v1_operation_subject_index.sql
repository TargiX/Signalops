alter table public.signalops_v1_events
  add column if not exists subject text;

update public.signalops_v1_events
set subject = payload ->> 'subject'
where subject is null;

alter table public.signalops_v1_events
  alter column subject set not null;

alter table public.signalops_v1_events
  drop constraint if exists signalops_v1_events_subject_check;

alter table public.signalops_v1_events
  add constraint signalops_v1_events_subject_check check (
    char_length(subject) between 10 and 180
    and subject ~ '^(operation|provider)/[A-Za-z0-9][A-Za-z0-9._:/-]*$'
  );

create index if not exists signalops_v1_events_tenant_subject_time_idx
  on public.signalops_v1_events (tenant_id, subject, event_time, received_at, event_id);

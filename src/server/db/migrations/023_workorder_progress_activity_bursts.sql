alter table operational_workorders
  add column if not exists progress_activity_version integer not null default 1;

alter table operational_workorders
  add column if not exists progress_pending_fields jsonb not null default '[]'::jsonb;

alter table operational_workorders
  drop constraint if exists operational_workorders_progress_activity_version_check;

alter table operational_workorders
  add constraint operational_workorders_progress_activity_version_check
  check (progress_activity_version > 0 and progress_activity_version <= progress_version);

alter table operational_workorders
  drop constraint if exists operational_workorders_progress_pending_fields_check;

alter table operational_workorders
  add constraint operational_workorders_progress_pending_fields_check
  check (jsonb_typeof(progress_pending_fields) = 'array');

comment on column operational_workorders.progress_activity_version is
  'Progress version included in the last grouped mechanic activity event.';

comment on column operational_workorders.progress_pending_fields is
  'Distinct mechanic progress fields changed since the last grouped activity event.';

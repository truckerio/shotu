alter table operational_workorders
  add column if not exists progress_version integer not null default 1;

alter table operational_workorders
  drop constraint if exists operational_workorders_progress_version_check;

alter table operational_workorders
  add constraint operational_workorders_progress_version_check
  check (progress_version > 0);

comment on column operational_workorders.progress_version is
  'Optimistic concurrency token for mechanic diagnosis and work-performed progress.';

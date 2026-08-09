alter table location_workorder_policies
  add column if not exists version bigint not null default 1 check (version > 0);

comment on column location_workorder_policies.version is
  'Optimistic concurrency version for location module policy compatibility writes.';

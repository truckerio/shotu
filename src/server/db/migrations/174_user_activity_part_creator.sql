set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table parts_catalog
  add column if not exists created_by uuid references user_profiles(id) on delete set null;

create index if not exists parts_catalog_creator_activity_idx
  on parts_catalog(created_by, created_at desc, id desc)
  where created_by is not null;

comment on column parts_catalog.created_by is
  'Authenticated user who created a local catalog part. Null means historical or provider-created ownership is unknown.';

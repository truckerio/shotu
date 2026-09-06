alter table parts_catalog
  add column if not exists tracking_mode varchar(24);

alter table parts_catalog
  drop constraint if exists parts_catalog_tracking_mode_check;

alter table parts_catalog
  add constraint parts_catalog_tracking_mode_check
  check (tracking_mode is null or tracking_mode in ('quantity', 'serialized', 'measured_bulk'));

comment on column parts_catalog.tracking_mode is
  'Company-wide physical tracking policy. Null means legacy part not yet reviewed; receipt behavior remains backward compatible until reviewed.';

create index if not exists parts_catalog_company_tracking_mode_idx
  on parts_catalog(company_id, tracking_mode, id);

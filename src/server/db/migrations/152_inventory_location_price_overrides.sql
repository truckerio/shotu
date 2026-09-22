set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_part_price_versions
  add column location_id uuid,
  add constraint inventory_part_price_location_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict;

do $$
declare version_constraint name;
begin
  select constraint_record.conname into version_constraint
  from pg_constraint constraint_record
  where constraint_record.conrelid = 'inventory_part_price_versions'::regclass
    and constraint_record.contype = 'u'
    and pg_get_constraintdef(constraint_record.oid) = 'UNIQUE (company_id, catalog_part_id, price_kind, version)';

  if version_constraint is null then
    raise exception 'Inventory part price version constraint was not found.';
  end if;
  execute format('alter table inventory_part_price_versions drop constraint %I', version_constraint);
end $$;

create unique index inventory_part_price_company_version_unique
  on inventory_part_price_versions(company_id, catalog_part_id, price_kind, version)
  where location_id is null;

create unique index inventory_part_price_location_version_unique
  on inventory_part_price_versions(company_id, location_id, catalog_part_id, price_kind, version)
  where location_id is not null;

create index inventory_part_price_location_current_idx
  on inventory_part_price_versions(company_id, location_id, catalog_part_id, price_kind, version desc)
  where location_id is not null;

comment on column inventory_part_price_versions.location_id is
  'Optional location override scope. Null rows are company defaults; a current location row, including Unknown, masks the company default.';

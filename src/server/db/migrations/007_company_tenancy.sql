-- Expand phase for UUID tenant ownership.
-- Legacy text keys remain available during rolling deploys and are synchronized
-- by triggers. New code reads/writes company_uuid.

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

create table if not exists company_legacy_keys (
  legacy_key text primary key,
  company_id uuid not null references companies(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  check (legacy_key = btrim(legacy_key) and legacy_key <> '')
);

create unique index if not exists company_legacy_keys_primary_uidx
  on company_legacy_keys(company_id)
  where is_primary = true;

insert into companies (id, slug, name)
values (
  '00000000-0000-0000-0000-000000000001',
  'default',
  'Default Company'
)
on conflict (id) do nothing;

insert into company_legacy_keys (legacy_key, company_id, is_primary)
values (
  'default',
  '00000000-0000-0000-0000-000000000001',
  true
)
on conflict (legacy_key) do nothing;

-- This deployment was historically single-company. Values such as Long Haul
-- and Chino Yard are labels/counter keys, not separate tenant identities.
with legacy_keys as (
  select company_id as legacy_key from locations
  union
  select company_id from operational_workorders
  union
  select company_id from workorder_serial_counters
  union
  select company_id from parts_catalog
  union
  select company_id from inventory_items
  union
  select company_id from user_company_memberships
  union
  select company_id from user_invitations
)
insert into company_legacy_keys (legacy_key, company_id, is_primary)
select
  btrim(legacy_key),
  '00000000-0000-0000-0000-000000000001'::uuid,
  false
from legacy_keys
where nullif(btrim(legacy_key), '') is not null
on conflict (legacy_key) do nothing;

alter table locations add column if not exists company_uuid uuid;
alter table operational_workorders add column if not exists company_uuid uuid;
alter table workorder_serial_counters add column if not exists company_uuid uuid;
alter table parts_catalog add column if not exists company_uuid uuid;
alter table inventory_items add column if not exists company_uuid uuid;
alter table user_company_memberships add column if not exists company_uuid uuid;
alter table user_invitations add column if not exists company_uuid uuid;
alter table assets add column if not exists company_uuid uuid;
alter table integration_accounts add column if not exists company_uuid uuid;
alter table integration_sync_runs add column if not exists company_uuid uuid;
alter table integration_sync_runs add column if not exists integration_account_id uuid;

update locations target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update operational_workorders target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update workorder_serial_counters target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update parts_catalog target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update inventory_items target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update user_company_memberships target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update user_invitations target
set company_uuid = mapping.company_id
from company_legacy_keys mapping
where mapping.legacy_key = target.company_id
  and target.company_uuid is null;

update assets asset
set company_uuid = coalesce(
  (
    select location.company_uuid
    from locations location
    where location.id = asset.location_id
  ),
  (
    select company.id
    from companies company
    where company.id = asset.organization_id
  ),
  '00000000-0000-0000-0000-000000000001'::uuid
)
where company_uuid is null;

update integration_accounts
set company_uuid = '00000000-0000-0000-0000-000000000001'::uuid
where company_uuid is null;

update integration_sync_runs run
set company_uuid = account.company_uuid,
    integration_account_id = account.id
from integration_accounts account
where run.integration_account_id is null
  and account.provider = run.provider;

update integration_sync_runs
set company_uuid = '00000000-0000-0000-0000-000000000001'::uuid
where company_uuid is null;

alter table locations alter column company_uuid set not null;
alter table operational_workorders alter column company_uuid set not null;
alter table workorder_serial_counters alter column company_uuid set not null;
alter table parts_catalog alter column company_uuid set not null;
alter table inventory_items alter column company_uuid set not null;
alter table user_company_memberships alter column company_uuid set not null;
alter table user_invitations alter column company_uuid set not null;
alter table assets alter column company_uuid set not null;
alter table integration_accounts alter column company_uuid set not null;
alter table integration_sync_runs alter column company_uuid set not null;

alter table locations
  add constraint locations_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete restrict;
alter table operational_workorders
  add constraint operational_workorders_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete restrict;
alter table workorder_serial_counters
  add constraint workorder_serial_counters_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete restrict;
alter table parts_catalog
  add constraint parts_catalog_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete restrict;
alter table inventory_items
  add constraint inventory_items_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete restrict;
alter table user_company_memberships
  add constraint user_company_memberships_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete cascade;
alter table user_invitations
  add constraint user_invitations_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete cascade;
alter table assets
  add constraint assets_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete restrict;
alter table integration_accounts
  add constraint integration_accounts_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete cascade;
alter table integration_sync_runs
  add constraint integration_sync_runs_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete cascade;
alter table integration_sync_runs
  add constraint integration_sync_runs_account_id_fkey
  foreign key (integration_account_id) references integration_accounts(id) on delete set null;

create or replace function sync_legacy_company_scope()
returns trigger
language plpgsql
as $$
declare
  resolved_uuid uuid;
  resolved_legacy text;
begin
  if new.company_uuid is null and nullif(btrim(new.company_id), '') is not null then
    select company_id into resolved_uuid
    from company_legacy_keys
    where legacy_key = btrim(new.company_id);
    if resolved_uuid is null then
      raise exception 'Unknown legacy company key: %', new.company_id;
    end if;
    new.company_uuid := resolved_uuid;
  end if;

  if new.company_uuid is not null then
    select legacy_key into resolved_legacy
    from company_legacy_keys
    where company_id = new.company_uuid
    order by is_primary desc, created_at, legacy_key
    limit 1;
    if resolved_legacy is null then
      raise exception 'Company % has no legacy compatibility key', new.company_uuid;
    end if;
    new.company_id := resolved_legacy;
  end if;

  return new;
end;
$$;

drop trigger if exists locations_sync_company_scope on locations;
create trigger locations_sync_company_scope
before insert or update of company_id, company_uuid on locations
for each row execute function sync_legacy_company_scope();

drop trigger if exists operational_workorders_sync_company_scope on operational_workorders;
create trigger operational_workorders_sync_company_scope
before insert or update of company_id, company_uuid on operational_workorders
for each row execute function sync_legacy_company_scope();

drop trigger if exists workorder_serial_counters_sync_company_scope on workorder_serial_counters;
create trigger workorder_serial_counters_sync_company_scope
before insert or update of company_id, company_uuid on workorder_serial_counters
for each row execute function sync_legacy_company_scope();

drop trigger if exists parts_catalog_sync_company_scope on parts_catalog;
create trigger parts_catalog_sync_company_scope
before insert or update of company_id, company_uuid on parts_catalog
for each row execute function sync_legacy_company_scope();

drop trigger if exists inventory_items_sync_company_scope on inventory_items;
create trigger inventory_items_sync_company_scope
before insert or update of company_id, company_uuid on inventory_items
for each row execute function sync_legacy_company_scope();

drop trigger if exists user_company_memberships_sync_company_scope on user_company_memberships;
create trigger user_company_memberships_sync_company_scope
before insert or update of company_id, company_uuid on user_company_memberships
for each row execute function sync_legacy_company_scope();

drop trigger if exists user_invitations_sync_company_scope on user_invitations;
create trigger user_invitations_sync_company_scope
before insert or update of company_id, company_uuid on user_invitations
for each row execute function sync_legacy_company_scope();

create unique index if not exists locations_company_uuid_id_uidx
  on locations(company_uuid, id);
create unique index if not exists assets_company_uuid_id_uidx
  on assets(company_uuid, id);
create unique index if not exists operational_workorders_company_uuid_id_uidx
  on operational_workorders(company_uuid, id);
create unique index if not exists inventory_items_company_uuid_id_uidx
  on inventory_items(company_uuid, id);
create unique index if not exists parts_catalog_company_uuid_id_uidx
  on parts_catalog(company_uuid, id);
create unique index if not exists integration_accounts_company_uuid_id_uidx
  on integration_accounts(company_uuid, id);
create unique index if not exists integration_accounts_company_provider_uidx
  on integration_accounts(company_uuid, provider);
create unique index if not exists assets_company_provider_uidx
  on assets(company_uuid, provider, provider_vehicle_id)
  where provider_vehicle_id is not null;
create index if not exists assets_company_uuid_unit_no_idx
  on assets(company_uuid, unit_no);
create index if not exists assets_company_uuid_vin_idx
  on assets(company_uuid, vin);
create index if not exists locations_company_uuid_active_idx
  on locations(company_uuid, active);
create index if not exists operational_workorders_company_uuid_status_idx
  on operational_workorders(company_uuid, status, updated_at desc);
create index if not exists parts_catalog_company_uuid_part_idx
  on parts_catalog(company_uuid, normalized_part_number);
create index if not exists inventory_items_company_uuid_part_idx
  on inventory_items(company_uuid, normalized_part_number);
create index if not exists integration_sync_runs_company_uuid_started_idx
  on integration_sync_runs(company_uuid, provider, started_at desc);

alter table operational_workorders
  add constraint operational_workorders_company_location_fkey
  foreign key (company_uuid, location_id)
  references locations(company_uuid, id)
  on delete restrict;
alter table operational_workorders
  add constraint operational_workorders_company_asset_fkey
  foreign key (company_uuid, asset_id)
  references assets(company_uuid, id)
  on delete restrict;
alter table inventory_items
  add constraint inventory_items_company_location_fkey
  foreign key (company_uuid, location_id)
  references locations(company_uuid, id)
  on delete restrict;
alter table user_invitations
  add constraint user_invitations_company_location_fkey
  foreign key (company_uuid, location_id)
  references locations(company_uuid, id)
  on delete restrict;
alter table integration_sync_runs
  add constraint integration_sync_runs_company_account_fkey
  foreign key (company_uuid, integration_account_id)
  references integration_accounts(company_uuid, id)
  on delete restrict;

alter table user_location_memberships add column if not exists company_uuid uuid;
update user_location_memberships membership
set company_uuid = location.company_uuid
from locations location
where location.id = membership.location_id
  and membership.company_uuid is null;
alter table user_location_memberships alter column company_uuid set not null;
alter table user_location_memberships
  add constraint user_location_memberships_company_uuid_fkey
  foreign key (company_uuid) references companies(id) on delete cascade;
alter table user_location_memberships
  add constraint user_location_memberships_company_location_fkey
  foreign key (company_uuid, location_id)
  references locations(company_uuid, id)
  on delete cascade;

create or replace function sync_location_membership_company()
returns trigger
language plpgsql
as $$
begin
  select company_uuid into new.company_uuid
  from locations
  where id = new.location_id;
  if new.company_uuid is null then
    raise exception 'Location % does not exist', new.location_id;
  end if;
  return new;
end;
$$;

create or replace function enforce_location_membership_company()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1
    from user_company_memberships membership
    where membership.user_id = new.user_id
      and membership.company_uuid = new.company_uuid
      and membership.active = true
  ) then
    raise exception 'User % has no active membership in location company %', new.user_id, new.company_uuid;
  end if;
  return new;
end;
$$;

drop trigger if exists user_location_memberships_sync_company on user_location_memberships;
create trigger user_location_memberships_sync_company
before insert or update of location_id on user_location_memberships
for each row execute function sync_location_membership_company();

drop trigger if exists user_location_memberships_enforce_company on user_location_memberships;
create constraint trigger user_location_memberships_enforce_company
after insert or update of user_id, location_id, company_uuid on user_location_memberships
deferrable initially deferred
for each row execute function enforce_location_membership_company();

create or replace function enforce_part_company_scope()
returns trigger
language plpgsql
as $$
declare
  workorder_company uuid;
  referenced_company uuid;
begin
  select company_uuid into workorder_company
  from operational_workorders
  where id = new.workorder_id;

  if new.catalog_part_id is not null then
    select company_uuid into referenced_company
    from parts_catalog
    where id = new.catalog_part_id;
    if referenced_company is distinct from workorder_company then
      raise exception 'Part catalog company does not match workorder company';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workorder_part_requests_company_scope on workorder_part_requests;
create constraint trigger workorder_part_requests_company_scope
after insert or update of workorder_id, catalog_part_id on workorder_part_requests
deferrable initially deferred
for each row execute function enforce_part_company_scope();

create or replace function enforce_allocation_company_scope()
returns trigger
language plpgsql
as $$
declare
  workorder_company uuid;
  referenced_company uuid;
begin
  select workorder.company_uuid into workorder_company
  from workorder_part_requests request
  join operational_workorders workorder on workorder.id = request.workorder_id
  where request.id = new.part_request_id;

  if new.inventory_item_id is not null then
    select company_uuid into referenced_company
    from inventory_items
    where id = new.inventory_item_id;
    if referenced_company is distinct from workorder_company then
      raise exception 'Inventory company does not match workorder company';
    end if;
  end if;

  if new.location_id is not null then
    select company_uuid into referenced_company
    from locations
    where id = new.location_id;
    if referenced_company is distinct from workorder_company then
      raise exception 'Allocation location company does not match workorder company';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists part_allocations_company_scope on part_allocations;
create constraint trigger part_allocations_company_scope
after insert or update of part_request_id, inventory_item_id, location_id on part_allocations
deferrable initially deferred
for each row execute function enforce_allocation_company_scope();

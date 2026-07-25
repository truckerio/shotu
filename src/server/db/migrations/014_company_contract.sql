-- Contract phase for tenant ownership. Runtime code must use UUID company_id.

drop view if exists v_odoo_backlog;
drop view if exists v_inventory_availability;
drop view if exists v_workorder_operations;
drop view if exists v_workorder_assignment_roster;
drop view if exists v_user_access_scope;

drop trigger if exists locations_sync_company_scope on locations;
drop trigger if exists operational_workorders_sync_company_scope on operational_workorders;
drop trigger if exists workorder_serial_counters_sync_company_scope on workorder_serial_counters;
drop trigger if exists parts_catalog_sync_company_scope on parts_catalog;
drop trigger if exists inventory_items_sync_company_scope on inventory_items;
drop trigger if exists user_company_memberships_sync_company_scope on user_company_memberships;
drop trigger if exists user_invitations_sync_company_scope on user_invitations;

-- Historical counter keys could map to one tenant. Preserve the safest next
-- number before replacing the text primary key with the company UUID.
create temporary table contracted_serial_counters on commit drop as
select
  company_uuid as company_id,
  min(prefix) as prefix,
  max(next_number) as next_number,
  max(digits) as digits,
  max(updated_at) as updated_at
from workorder_serial_counters
group by company_uuid;

truncate table workorder_serial_counters;
alter table workorder_serial_counters drop constraint if exists workorder_serial_counters_pkey;
alter table workorder_serial_counters drop column company_id;
alter table workorder_serial_counters rename column company_uuid to company_id;
alter table workorder_serial_counters add primary key (company_id);

insert into workorder_serial_counters (company_id, prefix, next_number, digits, updated_at)
select company_id, prefix, next_number, digits, updated_at
from contracted_serial_counters;

-- Membership aliases can also collapse to one tenant. Keep one row per user
-- and company, preferring active and more privileged membership data.
create temporary table contracted_company_memberships on commit drop as
select distinct on (user_id, company_uuid)
  user_id,
  company_uuid as company_id,
  role,
  bool_or(active) over (partition by user_id, company_uuid) as active,
  min(created_at) over (partition by user_id, company_uuid) as created_at,
  max(updated_at) over (partition by user_id, company_uuid) as updated_at
from user_company_memberships
order by
  user_id,
  company_uuid,
  active desc,
  case role
    when 'admin' then 1
    when 'office' then 2
    when 'surveillance' then 3
    else 4
  end;

truncate table user_company_memberships;
alter table user_company_memberships drop constraint if exists user_company_memberships_pkey;
alter table user_company_memberships drop column company_id;
alter table user_company_memberships rename column company_uuid to company_id;
alter table user_company_memberships add primary key (user_id, company_id);

insert into user_company_memberships (user_id, company_id, role, active, created_at, updated_at)
select user_id, company_id, role, active, created_at, updated_at
from contracted_company_memberships;

drop index if exists locations_company_active_idx;
drop index if exists locations_company_name_uidx;
alter table locations drop column company_id;
alter table locations rename column company_uuid to company_id;

alter table operational_workorders drop column company_id;
alter table operational_workorders rename column company_uuid to company_id;

alter table parts_catalog
  drop constraint if exists parts_catalog_company_id_normalized_part_number_key;
drop index if exists parts_catalog_company_part_idx;
alter table parts_catalog drop column company_id;
alter table parts_catalog rename column company_uuid to company_id;

drop index if exists inventory_items_company_location_part_idx;
drop index if exists inventory_items_company_part_idx;
alter table inventory_items drop column company_id;
alter table inventory_items rename column company_uuid to company_id;

alter table user_invitations drop column company_id;
alter table user_invitations rename column company_uuid to company_id;

alter table user_location_memberships rename column company_uuid to company_id;
alter table assets rename column company_uuid to company_id;
alter table integration_accounts rename column company_uuid to company_id;
alter table integration_sync_runs rename column company_uuid to company_id;

alter table integration_accounts drop constraint if exists integration_accounts_provider_key;
drop index if exists assets_provider_uid_idx;
alter table assets drop column if exists organization_id;

drop function if exists sync_legacy_company_scope();
drop table company_legacy_keys;

alter index if exists locations_company_uuid_id_uidx rename to locations_company_id_uidx;
alter index if exists assets_company_uuid_id_uidx rename to assets_company_id_uidx;
alter index if exists operational_workorders_company_uuid_id_uidx rename to operational_workorders_company_id_uidx;
alter index if exists inventory_items_company_uuid_id_uidx rename to inventory_items_company_id_uidx;
alter index if exists parts_catalog_company_uuid_id_uidx rename to parts_catalog_company_id_uidx;
alter index if exists integration_accounts_company_uuid_id_uidx rename to integration_accounts_company_id_uidx;
alter index if exists assets_company_uuid_unit_no_idx rename to assets_company_unit_no_idx;
alter index if exists assets_company_uuid_vin_idx rename to assets_company_vin_idx;
alter index if exists locations_company_uuid_active_idx rename to locations_company_active_idx;
alter index if exists operational_workorders_company_uuid_status_idx rename to operational_workorders_company_status_idx;
alter index if exists operational_workorders_company_uuid_serial_uidx rename to operational_workorders_company_serial_uidx;
alter index if exists parts_catalog_company_uuid_part_uidx rename to parts_catalog_company_part_uidx;
alter index if exists inventory_items_company_uuid_location_part_uidx rename to inventory_items_company_location_part_uidx;
alter index if exists integration_sync_runs_company_uuid_started_idx rename to integration_sync_runs_company_started_idx;

create unique index locations_company_name_uidx
  on locations(company_id, lower(btrim(name)));

comment on table companies is
  'Tenant root. Every tenant-owned row references companies.id through company_id.';
comment on column assets.company_id is
  'Application tenant ownership. External provider organization identifiers belong in external_ids or raw_provider_data.';
comment on table integration_accounts is
  'Server-only provider credentials and sync state. One provider connection per company.';

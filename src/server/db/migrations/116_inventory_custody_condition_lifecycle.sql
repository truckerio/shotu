set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_serialized_units
  add column if not exists condition_code text not null default 'unknown'
    check (condition_code in ('new','serviceable_used','refurbished','needs_repair','unserviceable','unknown')),
  add column if not exists custody_holder_type text not null default 'inventory_location'
    check (custody_holder_type in ('inventory_location','asset','handoff','internal_repair','external_repair','core_vendor','scrap_area','disposed','unknown')),
  add column if not exists custody_location_id uuid,
  add column if not exists custody_asset_id uuid,
  add column if not exists custody_bin_location text,
  add column if not exists custody_external_reference text,
  add column if not exists custody_version integer not null default 1 check (custody_version > 0),
  add column if not exists custody_legacy_available boolean not null default false;

-- Every row present before this migration has no durable condition evidence.  It
-- remains selectable only through this explicit compatibility flag; new intake
-- writers set a factual condition instead of inheriting this exception.
update inventory_serialized_units
  set condition_code='unknown', custody_holder_type=case when status in ('installed','installed_pending_approval') and exists(select 1 from workorder_serialized_part_usages usage where usage.company_id=inventory_serialized_units.company_id and usage.unit_id=inventory_serialized_units.id and usage.status in ('installed','installed_pending_approval')) then 'asset' else 'inventory_location' end,
      custody_location_id=case when status in ('installed','installed_pending_approval') and exists(select 1 from workorder_serialized_part_usages usage where usage.company_id=inventory_serialized_units.company_id and usage.unit_id=inventory_serialized_units.id and usage.status in ('installed','installed_pending_approval')) then null else location_id end,
      custody_asset_id=case when status in ('installed','installed_pending_approval') then (select usage.asset_id from workorder_serialized_part_usages usage where usage.company_id=inventory_serialized_units.company_id and usage.unit_id=inventory_serialized_units.id and usage.status in ('installed','installed_pending_approval') order by usage.updated_at desc limit 1) else null end,
      custody_legacy_available=true
  where condition_code='unknown' and custody_legacy_available=false;

alter table inventory_serialized_units
  add constraint inventory_serialized_units_custody_location_fk
  foreign key (company_id,custody_location_id) references locations(company_id,id);
alter table inventory_serialized_units
  add constraint inventory_serialized_units_custody_asset_fk
  foreign key (company_id,custody_asset_id) references assets(company_id,id);
alter table inventory_serialized_units
  add constraint inventory_serialized_units_custody_shape check (
    (custody_holder_type='asset' and custody_asset_id is not null)
    or (custody_holder_type <> 'asset' and custody_asset_id is null)
  );

alter table inventory_reuse_catalog_policies
  add column if not exists repair_allowed boolean not null default false,
  add column if not exists core_return_allowed boolean not null default false,
  add column if not exists scrap_allowed boolean not null default true;

alter table inventory_reuse_cases
  add column if not exists intended_route text not null default 'not_sure'
    check (intended_route in ('inspect_for_reuse','repair','core_return','scrap','not_sure')),
  add column if not exists final_route text,
  add column if not exists case_version integer not null default 1 check (case_version > 0),
  add column if not exists received_bin_location text,
  add column if not exists external_reference text,
  add column if not exists completed_at timestamptz;

alter table inventory_reuse_cases drop constraint inventory_reuse_cases_status_check;
alter table inventory_reuse_cases add constraint inventory_reuse_cases_status_check check (status in (
  'awaiting_handoff','received_pending_review','hold','repair','repair_complete_pending_review',
  'core_pending_return','core_returned','scrap_pending_approval','scrapped','quarantine','released'
));

alter table inventory_reuse_capability_grants drop constraint inventory_reuse_capability_grants_capability_check;
alter table inventory_reuse_capability_grants add constraint inventory_reuse_capability_grants_capability_check
  check (capability in ('remove','receive','release','route','repair','disposition','quarantine'));
alter table inventory_reuse_operations drop constraint inventory_reuse_operations_action_check;
alter table inventory_reuse_operations add constraint inventory_reuse_operations_action_check
  check (action in ('remove','receive','release','route','repair_start','repair_complete','core_return','scrap','quarantine_resolve'));
alter table inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table inventory_unit_events add constraint inventory_unit_events_event_type_check check (event_type in (
  'receipt_staged','receipt_confirmed','receipt_recorded','reconciliation_required','issued','reserved','installed_pending_approval','installed','returned','removed_returned_to_stock','removed','void',
  'reuse_received','reuse_hold','reuse_released','reuse_routed','reuse_repair_started','reuse_repair_completed','reuse_core_returned','reuse_scrapped','reuse_quarantine_resolved'
));
alter table inventory_unit_events drop constraint inventory_unit_events_workorder_shape;
alter table inventory_unit_events add constraint inventory_unit_events_workorder_shape check (
  (event_type in ('issued','reserved','installed_pending_approval','installed','returned','removed_returned_to_stock','removed','reuse_received','reuse_hold','reuse_released','reuse_routed','reuse_repair_started','reuse_repair_completed','reuse_core_returned','reuse_scrapped','reuse_quarantine_resolved') and usage_id is not null and workorder_id is not null and asset_id is not null)
  or (event_type not in ('issued','reserved','installed_pending_approval','installed','returned','removed_returned_to_stock','removed','reuse_received','reuse_hold','reuse_released','reuse_routed','reuse_repair_started','reuse_repair_completed','reuse_core_returned','reuse_scrapped','reuse_quarantine_resolved') and usage_id is null and workorder_id is null and asset_id is null)
);

create table if not exists inventory_reuse_repairs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  case_id uuid not null,
  handler_type text not null check (handler_type in ('internal','external')),
  handler_reference text not null check (length(trim(handler_reference)) > 0),
  started_at timestamptz not null default now(), completed_at timestamptz,
  evidence text not null default '', version integer not null default 1 check(version>0),
  unique(company_id,case_id),
  foreign key(company_id,case_id) references inventory_reuse_cases(company_id,id)
);

create index if not exists inventory_reuse_case_state_cursor_idx
  on inventory_reuse_cases(company_id,location_id,status,updated_at desc,id desc);
create index if not exists inventory_serialized_units_custody_lookup_idx
  on inventory_serialized_units(company_id,location_id,status,condition_code,custody_holder_type,id);

comment on column inventory_serialized_units.custody_bin_location is
  'Optional validated free text; no bins relation is assumed.';

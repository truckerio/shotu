-- Stable read projections for administration, reporting, and database support.
-- These views expose UUID company ownership while compatibility text columns
-- remain in place for the tenant expand/contract rollout.

alter table operational_workorders
  drop constraint if exists operational_workorders_status_check;

alter table operational_workorders
  add constraint operational_workorders_status_check check (status in (
    'open', 'accepted', 'in_progress', 'mechanic_done', 'closed', 'odoo_entered', 'cancelled'
  ));

create or replace function normalize_workorder_lifecycle_status()
returns trigger
language plpgsql
as $$
declare
  attention_was_active boolean;
begin
  if new.status not in ('waiting_office', 'parts_requested') then
    return new;
  end if;

  if new.status = 'waiting_office' then
    select active into attention_was_active
    from workorder_attention_state
    where workorder_id = new.id and reason = 'office_help';

    insert into workorder_attention_state (
      workorder_id, reason, active, details, opened_at, resolved_by_user_id, resolved_at, updated_at
    ) values (
      new.id, 'office_help', true, jsonb_build_object('source', 'legacy_status_write'), now(), null, null, now()
    )
    on conflict (workorder_id, reason) do update
    set active = true,
        details = excluded.details,
        resolved_by_user_id = null,
        resolved_at = null,
        updated_at = now();

    if not coalesce(attention_was_active, false) then
      insert into workorder_attention_events (workorder_id, reason, action, details)
      values (
        new.id,
        'office_help',
        case when attention_was_active is false then 'reopened' else 'opened' end,
        jsonb_build_object('source', 'legacy_status_write')
      );
    end if;
  end if;

  if tg_op = 'UPDATE'
     and old.status in ('open', 'accepted', 'in_progress', 'mechanic_done', 'closed', 'odoo_entered', 'cancelled') then
    new.status := old.status;
  elsif new.current_mechanic_id is null then
    new.status := 'open';
  elsif new.started_at is null then
    new.status := 'accepted';
  else
    new.status := 'in_progress';
  end if;

  return new;
end;
$$;

create or replace function discard_legacy_workorder_status_event()
returns trigger
language plpgsql
as $$
begin
  if new.to_status in ('waiting_office', 'parts_requested') then
    return null;
  end if;
  return new;
end;
$$;

create or replace view v_user_access_scope as
select
  profile.id as user_id,
  profile.auth_user_id,
  profile.name,
  profile.email,
  profile.active as user_active,
  company.id as company_id,
  company.slug as company_slug,
  company.name as company_name,
  company_membership.role as company_role,
  company_membership.active as company_membership_active,
  location.id as location_id,
  location.name as location_name,
  location.type as location_type,
  coalesce(location_membership.active, false) as location_membership_active
from app_users profile
join user_company_memberships company_membership
  on company_membership.user_id = profile.id
join companies company
  on company.id = company_membership.company_uuid
left join user_location_memberships location_membership
  on location_membership.user_id = profile.id
 and location_membership.company_uuid = company.id
left join locations location
  on location.id = location_membership.location_id
 and location.company_uuid = company.id;

create or replace view v_workorder_assignment_roster as
select
  assignment.workorder_id,
  count(*) filter (where assignment.active)::integer as active_mechanic_count,
  (array_agg(assignment.mechanic_user_id order by assignment.assigned_at) filter (
    where assignment.active and assignment.assignment_role = 'primary'
  ))[1] as primary_mechanic_id,
  max(profile.name) filter (
    where assignment.active and assignment.assignment_role = 'primary'
  ) as primary_mechanic_name,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', assignment.mechanic_user_id,
        'name', profile.name,
        'role', assignment.assignment_role,
        'assignedAt', assignment.assigned_at
      )
      order by
        case when assignment.assignment_role = 'primary' then 0 else 1 end,
        assignment.assigned_at,
        profile.name
    ) filter (where assignment.active),
    '[]'::jsonb
  ) as active_mechanics
from workorder_mechanic_assignments assignment
join app_users profile on profile.id = assignment.mechanic_user_id
group by assignment.workorder_id;

create or replace view v_workorder_operations as
select
  workorder.id,
  workorder.company_uuid as company_id,
  company.slug as company_slug,
  company.name as company_name,
  workorder.serial,
  workorder.status,
  workorder.concern,
  workorder.diagnosis,
  workorder.work_performed,
  workorder.created_at,
  workorder.updated_at,
  workorder.accepted_at,
  workorder.started_at,
  workorder.mechanic_done_at,
  workorder.closed_at,
  location.id as location_id,
  location.name as location_name,
  asset.id as asset_id,
  asset.unit_type,
  asset.unit_no,
  asset.vin,
  asset.make,
  asset.model,
  asset.year,
  roster.primary_mechanic_id,
  roster.primary_mechanic_name,
  coalesce(roster.active_mechanic_count, 0) as active_mechanic_count,
  coalesce(roster.active_mechanics, '[]'::jsonb) as active_mechanics,
  coalesce(attention.active_reasons, array[]::text[]) as attention_reasons,
  coalesce(parts.pending_part_requests, 0) as pending_part_requests,
  coalesce(odoo.status, 'not_entered') as odoo_status,
  odoo.odoo_service_order_no
from operational_workorders workorder
join companies company on company.id = workorder.company_uuid
join locations location
  on location.id = workorder.location_id
 and location.company_uuid = workorder.company_uuid
left join assets asset
  on asset.id = workorder.asset_id
 and asset.company_uuid = workorder.company_uuid
left join v_workorder_assignment_roster roster on roster.workorder_id = workorder.id
left join lateral (
  select array_agg(state.reason order by state.reason) as active_reasons
  from workorder_attention_state state
  where state.workorder_id = workorder.id and state.active
) attention on true
left join lateral (
  select count(*)::integer as pending_part_requests
  from workorder_part_requests request
  where request.workorder_id = workorder.id
    and request.approval_status in ('submitted', 'needs_info', 'approved')
    and request.usage_status not in ('installed', 'returned')
) parts on true
left join odoo_entry_status odoo on odoo.workorder_id = workorder.id;

create or replace view v_inventory_availability as
select
  inventory.id,
  inventory.company_uuid as company_id,
  company.slug as company_slug,
  location.id as location_id,
  location.name as location_name,
  inventory.catalog_part_id,
  inventory.normalized_part_number,
  inventory.part_number,
  inventory.manufacturer,
  inventory.description,
  inventory.quantity_on_hand,
  inventory.quantity_reserved,
  greatest(inventory.quantity_on_hand - inventory.quantity_reserved, 0) as quantity_available,
  inventory.bin_location,
  inventory.updated_at
from inventory_items inventory
join companies company on company.id = inventory.company_uuid
left join locations location
  on location.id = inventory.location_id
 and location.company_uuid = inventory.company_uuid;

create or replace view v_odoo_backlog as
select operations.*
from v_workorder_operations operations
where operations.status = 'closed'
  and operations.odoo_status <> 'entered';

comment on table companies is
  'Tenant root. Business data is scoped to companies.id; legacy text keys exist only for rolling compatibility.';
comment on table company_legacy_keys is
  'Maps pre-tenant text keys to one canonical company during the expand/contract migration.';
comment on column operational_workorders.company_uuid is
  'Canonical workorder tenant ownership. The text company_id column is a temporary compatibility projection.';
comment on column operational_workorders.current_mechanic_id is
  'Compatibility projection of the active primary mechanic. The assignment table owns the complete mechanic team.';
comment on column operational_workorders.form_data is
  'Printable snapshot and legacy projection. Typed columns and child workflow tables remain operational truth.';
comment on table workorder_mechanic_assignments is
  'Canonical active and historical mechanic team assignments for a workorder.';
comment on table workorder_status_events is
  'Append-only lifecycle transition audit. Attention and parts requests are separate workflow dimensions.';
comment on table workorder_attention_state is
  'Current non-lifecycle attention reasons such as office help or missing information.';
comment on table workorder_part_requests is
  'Structured mechanic-to-office part requests. OpenAI/provider output is advisory, not source of truth.';
comment on table integration_accounts is
  'Server-only external provider connection metadata and secret material, scoped to a company.';
comment on view v_user_access_scope is
  'Support view showing effective company and location memberships without credential data.';
comment on view v_workorder_operations is
  'Support/reporting projection of workorders, assets, locations, mechanic teams, attention, parts, and Odoo state.';
comment on view v_inventory_availability is
  'Support/reporting projection of location inventory with computed available quantity.';
comment on view v_odoo_backlog is
  'Closed workorders that still require an Odoo service-order entry.';

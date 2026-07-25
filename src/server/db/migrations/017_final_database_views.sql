-- Stable support projections over final contract names. Views contain no
-- credentials, tokens, invitation secrets, or authorization bypass logic.

create or replace function sync_location_membership_company()
returns trigger
language plpgsql
as $$
begin
  select company_id into new.company_id
  from locations
  where id = new.location_id;
  if new.company_id is null then
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
      and membership.company_id = new.company_id
      and membership.active
  ) then
    raise exception 'User % has no active membership in location company %', new.user_id, new.company_id;
  end if;
  return new;
end;
$$;

create or replace function enforce_part_company_scope()
returns trigger
language plpgsql
as $$
declare
  workorder_company uuid;
  referenced_company uuid;
begin
  select company_id into workorder_company
  from operational_workorders
  where id = new.workorder_id;

  if new.catalog_part_id is not null then
    select company_id into referenced_company
    from parts_catalog
    where id = new.catalog_part_id;
    if referenced_company is distinct from workorder_company then
      raise exception 'Part catalog company does not match workorder company';
    end if;
  end if;
  return new;
end;
$$;

create or replace function enforce_allocation_company_scope()
returns trigger
language plpgsql
as $$
declare
  workorder_company uuid;
  referenced_company uuid;
begin
  select workorder.company_id into workorder_company
  from workorder_part_requests request
  join operational_workorders workorder on workorder.id = request.workorder_id
  where request.id = new.part_request_id;

  if new.inventory_item_id is not null then
    select company_id into referenced_company
    from inventory_items
    where id = new.inventory_item_id;
    if referenced_company is distinct from workorder_company then
      raise exception 'Inventory company does not match workorder company';
    end if;
  end if;

  if new.location_id is not null then
    select company_id into referenced_company
    from locations
    where id = new.location_id;
    if referenced_company is distinct from workorder_company then
      raise exception 'Allocation location company does not match workorder company';
    end if;
  end if;
  return new;
end;
$$;

create or replace function normalize_workorder_lifecycle_status()
returns trigger
language plpgsql
as $$
declare
  attention_was_active boolean;
  has_primary_mechanic boolean;
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
    return new;
  end if;

  select exists (
    select 1
    from workorder_mechanic_assignments assignment
    where assignment.workorder_id = new.id
      and assignment.active
      and assignment.assignment_role = 'primary'
  ) into has_primary_mechanic;

  if not has_primary_mechanic then
    new.status := 'open';
  elsif new.started_at is null then
    new.status := 'accepted';
  else
    new.status := 'in_progress';
  end if;
  return new;
end;
$$;

create or replace view v_user_access_scope as
select
  profile.id as user_id,
  profile.auth_user_id,
  profile.display_name,
  profile.contact_email,
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
from user_profiles profile
join user_company_memberships company_membership
  on company_membership.user_id = profile.id
join companies company
  on company.id = company_membership.company_id
left join user_location_memberships location_membership
  on location_membership.user_id = profile.id
 and location_membership.company_id = company.id
left join locations location
  on location.id = location_membership.location_id
 and location.company_id = company.id;

create or replace view v_user_primary_role as
select distinct on (membership.user_id)
  membership.user_id,
  membership.role
from user_company_memberships membership
where membership.active
order by
  membership.user_id,
  case membership.role
    when 'admin' then 1
    when 'office' then 2
    when 'surveillance' then 3
    else 4
  end,
  membership.created_at;

create or replace view v_workorder_assignment_roster as
select
  assignment.workorder_id,
  count(*) filter (where assignment.active)::integer as active_mechanic_count,
  (array_agg(assignment.mechanic_user_id order by assignment.assigned_at) filter (
    where assignment.active and assignment.assignment_role = 'primary'
  ))[1] as primary_mechanic_id,
  max(profile.display_name) filter (
    where assignment.active and assignment.assignment_role = 'primary'
  ) as primary_mechanic_name,
  coalesce(
    jsonb_agg(
      jsonb_build_object(
        'userId', assignment.mechanic_user_id,
        'name', profile.display_name,
        'role', assignment.assignment_role,
        'assignedAt', assignment.assigned_at
      )
      order by
        case when assignment.assignment_role = 'primary' then 0 else 1 end,
        assignment.assigned_at,
        profile.display_name
    ) filter (where assignment.active),
    '[]'::jsonb
  ) as active_mechanics
from workorder_mechanic_assignments assignment
join user_profiles profile on profile.id = assignment.mechanic_user_id
group by assignment.workorder_id;

create or replace view v_workorder_operations as
select
  workorder.id,
  workorder.company_id,
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
join companies company on company.id = workorder.company_id
join locations location
  on location.id = workorder.location_id
 and location.company_id = workorder.company_id
left join assets asset
  on asset.id = workorder.asset_id
 and asset.company_id = workorder.company_id
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
  inventory.company_id,
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
join companies company on company.id = inventory.company_id
left join locations location
  on location.id = inventory.location_id
 and location.company_id = inventory.company_id;

create or replace view v_odoo_backlog as
select operations.*
from v_workorder_operations operations
where operations.status = 'closed'
  and operations.odoo_status <> 'entered';

comment on view v_user_access_scope is
  'Effective company and location memberships without authentication secrets.';
comment on view v_user_primary_role is
  'Compatibility projection selecting one workspace role while company memberships remain authoritative.';
comment on view v_workorder_assignment_roster is
  'Current mechanic team projection derived only from assignment rows.';
comment on view v_workorder_operations is
  'Support projection joining workorders, assets, locations, mechanics, attention, parts, and Odoo state.';
comment on view v_inventory_availability is
  'Location inventory with computed available quantity.';
comment on view v_odoo_backlog is
  'Closed workorders awaiting Odoo entry.';

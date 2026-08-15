-- Converge environments that applied the original strict index migration.
-- The trigger preserves legacy duplicates while blocking every new conflict.

drop index if exists operational_workorders_one_active_per_asset_uidx;

create or replace function enforce_one_active_workorder_per_asset()
returns trigger
language plpgsql
as $$
begin
  if new.asset_id is null
     or new.status in ('closed', 'odoo_entered', 'cancelled') then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.asset_id is not distinct from new.asset_id
     and old.status not in ('closed', 'odoo_entered', 'cancelled') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.asset_id::text, 0));

  if exists (
    select 1
    from operational_workorders existing
    where existing.asset_id = new.asset_id
      and existing.id <> new.id
      and existing.status not in ('closed', 'odoo_entered', 'cancelled')
  ) then
    raise exception using
      errcode = '23505',
      constraint = 'operational_workorders_one_active_per_asset_uidx',
      message = 'Asset already has an active workorder.';
  end if;

  return new;
end;
$$;

drop trigger if exists operational_workorders_one_active_per_asset on operational_workorders;
create trigger operational_workorders_one_active_per_asset
before insert or update of asset_id, status on operational_workorders
for each row execute function enforce_one_active_workorder_per_asset();

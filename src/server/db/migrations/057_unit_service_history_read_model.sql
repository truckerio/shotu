set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Keep completion, scheduled, and recorded dates separate. In particular, an
-- Odoo commitment_date is a schedule promise and is never completion proof.
alter table service_history_orders
  add column recorded_at timestamptz,
  add column scheduled_at timestamptz,
  add column completion_date_kind text not null default 'unknown'
    check (completion_date_kind in ('verified_completed', 'work_done', 'recorded', 'scheduled', 'unknown'));

create function service_history_safe_timestamptz(value jsonb)
returns timestamptz
language plpgsql
as $$
begin
  if value is null or jsonb_typeof(value) <> 'string' then return null; end if;
  begin
    return trim(both '"' from value::text)::timestamptz;
  exception when others then
    return null;
  end;
end;
$$;

update service_history_orders history
set recorded_at = service_history_safe_timestamptz(history.raw_metadata -> 'date_order'),
    scheduled_at = service_history_safe_timestamptz(history.raw_metadata -> 'commitment_date'),
    completed_at = service_history_safe_timestamptz(history.raw_metadata -> 'effective_date'),
    completion_date_kind = case
      when service_history_safe_timestamptz(history.raw_metadata -> 'effective_date') is not null then 'verified_completed'
      when service_history_safe_timestamptz(history.raw_metadata -> 'commitment_date') is not null then 'scheduled'
      when service_history_safe_timestamptz(history.raw_metadata -> 'date_order') is not null then 'recorded'
      else 'unknown'
    end
where history.source_provider = 'odoo';

drop function service_history_safe_timestamptz(jsonb);

update service_history_orders history
set recorded_at = workorder.created_at,
    scheduled_at = null,
    completed_at = coalesce(workorder.closed_at, workorder.mechanic_done_at),
    completion_date_kind = case
      when workorder.closed_at is not null then 'verified_completed'
      when workorder.mechanic_done_at is not null then 'work_done'
      else 'recorded'
    end
from operational_workorders workorder
where history.company_id = workorder.company_id
  and history.source_provider = 'local'
  and history.external_id = workorder.id::text;

-- Migration 045's local refresh trigger remains the canonical suggestion
-- materializer. This second, alphabetically-later trigger only corrects the
-- date fields after that function has run.
create or replace function normalize_local_service_history_dates()
returns trigger
language plpgsql
as $$
begin
  update service_history_orders
  set recorded_at = new.created_at,
      scheduled_at = null,
      completed_at = coalesce(new.closed_at, new.mechanic_done_at),
      completion_date_kind = case
        when new.closed_at is not null then 'verified_completed'
        when new.mechanic_done_at is not null then 'work_done'
        else 'recorded'
      end,
      updated_at = now()
  where company_id = new.company_id
    and source_provider = 'local'
    and external_id = new.id::text;
  return new;
end;
$$;

create trigger zz_operational_workorders_normalize_service_history_dates
after insert or update of status, mechanic_done_at, closed_at
on operational_workorders
for each row execute function normalize_local_service_history_dates();

create index service_history_orders_unit_timeline_idx
  on service_history_orders(
    company_id,
    asset_id,
    (coalesce(completed_at, scheduled_at, recorded_at, ordered_at, source_updated_at)) desc,
    id desc
  )
  where asset_id is not null and completed_at is not null;

-- Attempts and failures are separate from the last successful watermark. A
-- failed provider read must retain prior history and its successful freshness.
alter table service_history_sync_state
  add column last_attempted_at timestamptz,
  add column last_succeeded_at timestamptz,
  add column last_error_at timestamptz,
  add column last_error_code text not null default '',
  add column last_error_message text not null default '';

update service_history_sync_state
set last_attempted_at = updated_at,
    last_succeeded_at = updated_at
where provider_watermark is not null;

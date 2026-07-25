-- Separate lifecycle from operational attention without creating another
-- workorder record. Legacy waiting/parts statuses are normalized in place.

create table if not exists workorder_attention_state (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  reason text not null check (reason in ('parts', 'office_help', 'missing_info')),
  active boolean not null default true,
  details jsonb not null default '{}',
  opened_by_user_id uuid references app_users(id) on delete set null,
  resolved_by_user_id uuid references app_users(id) on delete set null,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workorder_id, reason)
);

create table if not exists workorder_attention_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  reason text not null check (reason in ('parts', 'office_help', 'missing_info')),
  action text not null check (action in ('opened', 'updated', 'resolved', 'reopened')),
  actor_user_id uuid references app_users(id) on delete set null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists workorder_read_state (
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  last_seen_activity_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (workorder_id, user_id)
);

create table if not exists user_workorder_preferences (
  user_id uuid primary key references app_users(id) on delete cascade,
  default_location_id uuid references locations(id) on delete set null,
  default_view text not null default 'all',
  page_size integer not null default 50 check (page_size between 10 and 200),
  saved_filters jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

insert into workorder_attention_state (workorder_id, reason, details, opened_at, updated_at)
select id, 'office_help', jsonb_build_object('source', 'legacy_status'), updated_at, updated_at
from operational_workorders
where status = 'waiting_office'
on conflict (workorder_id, reason) do update
set active = true,
    resolved_by_user_id = null,
    resolved_at = null,
    details = excluded.details,
    updated_at = excluded.updated_at;

insert into workorder_attention_events (workorder_id, reason, action, details, created_at)
select id, 'office_help', 'opened', jsonb_build_object('source', 'legacy_status'), updated_at
from operational_workorders
where status = 'waiting_office';

update operational_workorders
set closed_at = coalesce(closed_at, updated_at)
where status = 'cancelled';

update operational_workorders
set status = case
  when status = 'cancelled' then 'closed'
  when current_mechanic_id is null then 'open'
  when started_at is null then 'accepted'
  else 'in_progress'
end
where status in ('waiting_office', 'parts_requested', 'cancelled');

alter table operational_workorders
  drop constraint if exists operational_workorders_status_check;

alter table operational_workorders
  add constraint operational_workorders_status_check check (status in (
    'open', 'accepted', 'in_progress', 'mechanic_done', 'closed', 'odoo_entered'
  ));

create or replace function normalize_workorder_lifecycle_status()
returns trigger
language plpgsql
as $$
declare
  attention_was_active boolean;
begin
  if new.status not in ('waiting_office', 'parts_requested', 'cancelled') then
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

  if tg_op = 'UPDATE' and old.status in ('open', 'accepted', 'in_progress', 'mechanic_done', 'closed', 'odoo_entered') then
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

drop trigger if exists operational_workorders_normalize_lifecycle on operational_workorders;
create trigger operational_workorders_normalize_lifecycle
before insert or update of status on operational_workorders
for each row execute function normalize_workorder_lifecycle_status();

create or replace function discard_legacy_workorder_status_event()
returns trigger
language plpgsql
as $$
begin
  if new.to_status in ('waiting_office', 'parts_requested', 'cancelled') then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists workorder_status_events_discard_legacy on workorder_status_events;
create trigger workorder_status_events_discard_legacy
before insert or update of to_status on workorder_status_events
for each row execute function discard_legacy_workorder_status_event();

create index if not exists workorder_attention_state_active_idx
  on workorder_attention_state(workorder_id, reason)
  where active = true;
create index if not exists workorder_attention_events_workorder_idx
  on workorder_attention_events(workorder_id, created_at desc);
create index if not exists workorder_read_state_user_idx
  on workorder_read_state(user_id, updated_at desc);
create index if not exists operational_workorders_location_activity_idx
  on operational_workorders(location_id, updated_at desc);

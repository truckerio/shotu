set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_position_count_sessions
  add column if not exists submitted_by uuid references user_profiles(id) on delete restrict,
  add column if not exists submitted_at timestamptz;

alter table inventory_position_count_commands
  drop constraint if exists inventory_position_count_commands_action_check;
alter table inventory_position_count_commands
  add constraint inventory_position_count_commands_action_check
  check(action in ('observe','observe_identity','add_found','submit','apply'));

with ranked as (
  select id,company_id,position_id,
    first_value(id) over(partition by company_id,position_id order by created_at desc,id desc) keeper_id,
    row_number() over(partition by company_id,position_id order by created_at desc,id desc) row_number
  from inventory_position_count_sessions
  where status in ('open','ready')
)
update inventory_position_count_sessions session
set status='superseded',superseded_by_session_id=ranked.keeper_id,version=session.version+1,updated_at=now()
from ranked
where session.company_id=ranked.company_id and session.id=ranked.id and ranked.row_number>1;

create unique index if not exists inventory_position_count_one_active_position_idx
  on inventory_position_count_sessions(company_id,position_id)
  where status in ('open','ready');

create or replace function inventory_position_ready_count_archive_guard() returns trigger language plpgsql as $$
begin
  if old.is_active and not new.is_active and exists(
    select 1 from inventory_position_count_sessions
    where company_id=old.company_id and position_id=old.id and status='ready'
  ) then
    raise exception 'Inventory position still has a submitted physical count.';
  end if;
  return new;
end $$;

drop trigger if exists inventory_position_ready_count_archive_guard on inventory_positions;
create trigger inventory_position_ready_count_archive_guard
before update of is_active on inventory_positions
for each row execute function inventory_position_ready_count_archive_guard();

comment on column inventory_position_count_sessions.submitted_at is
  'Observation-only completion time. Submitting a count does not change inventory balances.';

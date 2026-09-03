set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Preserve the cancelled link as history while allowing a reopened obligation
-- to link a replacement workorder.
alter table inspection_workorder_links
  drop constraint if exists inspection_workorder_links_company_id_inspection_id_finding_id_key;
alter table inspection_workorder_links
  add constraint inspection_workorder_links_finding_workorder_key
  unique(company_id,inspection_id,finding_id,workorder_id);

create table inspection_finding_follow_ups (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  inspection_id uuid not null,
  finding_id uuid not null,
  status text not null default 'open' check (status in ('open','resolved_workorder','resolved_no_workorder','reopened')),
  workorder_id uuid,
  resolution_reason text not null default '' check (char_length(resolution_reason) <= 2000),
  version bigint not null default 1 check (version > 0),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_user_id uuid references user_profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint inspection_follow_up_finding_fk foreign key (company_id,inspection_id,finding_id)
    references inspection_findings(company_id,inspection_id,id) on delete restrict,
  constraint inspection_follow_up_workorder_fk foreign key (company_id,workorder_id)
    references operational_workorders(company_id,id) on delete restrict,
  constraint inspection_follow_up_shape check (
    (status = 'open' and workorder_id is null and resolution_reason = '' and resolved_at is null and resolved_by_user_id is null)
    or (status = 'resolved_workorder' and workorder_id is not null and resolution_reason = '' and resolved_at is not null and resolved_by_user_id is not null)
    or (status = 'resolved_no_workorder' and workorder_id is null and btrim(resolution_reason) <> '' and resolved_at is not null and resolved_by_user_id is not null)
    or (status = 'reopened' and workorder_id is not null and resolved_at is null and resolved_by_user_id is null)
  ),
  unique (company_id,inspection_id,finding_id),
  unique (company_id,id)
);
create index inspection_follow_ups_needs_action_idx on inspection_finding_follow_ups(company_id,inspection_id,updated_at desc)
  where status in ('open','reopened');
create index inspection_follow_ups_workorder_idx on inspection_finding_follow_ups(company_id,workorder_id)
  where workorder_id is not null;

create table inspection_finding_follow_up_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  follow_up_id uuid not null,
  event_type text not null check (event_type in ('opened','resolved_workorder','resolved_no_workorder','reopened')),
  from_status text,
  to_status text not null,
  actor_id uuid references user_profiles(id) on delete restrict,
  workorder_id uuid,
  reason text not null default '' check (char_length(reason) <= 2000),
  source_workorder_status text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint inspection_follow_up_event_owner_fk foreign key (company_id,follow_up_id)
    references inspection_finding_follow_ups(company_id,id) on delete restrict,
  constraint inspection_follow_up_event_workorder_fk foreign key (company_id,workorder_id)
    references operational_workorders(company_id,id) on delete restrict
);
create index inspection_follow_up_events_timeline_idx on inspection_finding_follow_up_events(company_id,follow_up_id,created_at,id);

create table inspection_follow_up_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  follow_up_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action text not null check (action in ('link_workorder','create_workorder','no_workorder')),
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  workorder_id uuid,
  created_at timestamptz not null default now(),
  constraint inspection_follow_up_command_owner_fk foreign key (company_id,follow_up_id)
    references inspection_finding_follow_ups(company_id,id) on delete restrict,
  constraint inspection_follow_up_command_workorder_fk foreign key (company_id,workorder_id)
    references operational_workorders(company_id,id) on delete restrict,
  unique (company_id, actor_id, idempotency_key)
);

create function protect_inspection_follow_up_evidence()
returns trigger language plpgsql as $$ begin
  raise exception 'Inspection follow-up evidence is immutable.' using errcode = '55000';
end; $$;
create trigger inspection_finding_follow_up_events_append_only before update or delete on inspection_finding_follow_up_events
  for each row execute function protect_inspection_follow_up_evidence();
create trigger inspection_follow_up_commands_append_only before update or delete on inspection_follow_up_commands
  for each row execute function protect_inspection_follow_up_evidence();

insert into inspection_finding_follow_ups(company_id,inspection_id,finding_id,opened_at)
select finding.company_id,finding.inspection_id,finding.id,coalesce(inspection.completed_at,finding.created_at)
from inspection_findings finding
join inspections inspection on inspection.company_id=finding.company_id and inspection.id=finding.inspection_id
where inspection.status='completed' and finding.disposition='office_follow_up'
on conflict(company_id,inspection_id,finding_id) do nothing;

insert into inspection_finding_follow_up_events(company_id,follow_up_id,event_type,from_status,to_status,actor_id,details,created_at)
select follow_up.company_id,follow_up.id,'opened',null,'open',completion.actor_id,'{"source":"migration_106_backfill"}'::jsonb,follow_up.opened_at
from inspection_finding_follow_ups follow_up
left join lateral (
  select event.actor_id from inspection_events event
  where event.company_id=follow_up.company_id and event.inspection_id=follow_up.inspection_id and event.event_type='completed'
  order by event.created_at desc,event.id desc limit 1
) completion on true
where not exists(select 1 from inspection_finding_follow_up_events event where event.company_id=follow_up.company_id and event.follow_up_id=follow_up.id);

create function reopen_inspection_follow_ups_on_workorder_cancellation()
returns trigger language plpgsql as $$
declare obligation inspection_finding_follow_ups%rowtype;
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    for obligation in
      update inspection_finding_follow_ups
      set status = 'reopened',resolved_at=null,resolved_by_user_id=null,version=version+1,updated_at=now()
      where company_id=new.company_id and workorder_id=new.id and status='resolved_workorder'
      returning *
    loop
      insert into inspection_finding_follow_up_events(company_id,follow_up_id,event_type,from_status,to_status,actor_id,workorder_id,reason,source_workorder_status,details)
      values(obligation.company_id,obligation.id,'reopened','resolved_workorder','reopened',new.cancelled_by_user_id,new.id,new.cancel_reason,new.status,'{"source":"workorder_cancellation"}'::jsonb);
    end loop;
  end if;
  return new;
end; $$;
create trigger operational_workorder_reopen_inspection_follow_ups
  after update of status on operational_workorders
  for each row execute function reopen_inspection_follow_ups_on_workorder_cancellation();

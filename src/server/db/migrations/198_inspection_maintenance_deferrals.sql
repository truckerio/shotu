set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function inspection_deferral_policy_valid(policy jsonb)
returns boolean immutable language plpgsql as $$
declare
  due_date text;
  due_miles numeric;
  baseline_miles numeric;
  additional_miles numeric;
begin
  if policy is null or jsonb_typeof(policy) <> 'object' then return false; end if;
  if char_length(btrim(coalesce(policy->>'reason',''))) not between 2 and 2000 then return false; end if;
  if not (policy ?& array['nextVisit','dueDate','dueMiles','baselineMiles','additionalMiles','earlyMiles']) then return false; end if;
  if coalesce(jsonb_typeof(policy->'nextVisit'),'') <> 'boolean' then return false; end if;
  if coalesce(jsonb_typeof(policy->'earlyMiles'),'') <> 'number' or (policy->>'earlyMiles')::numeric not between 0 and 10000 then return false; end if;
  if jsonb_typeof(policy->'dueDate') not in ('null','string') then return false; end if;
  due_date := nullif(policy->>'dueDate','');
  if due_date is not null and (due_date !~ '^\d{4}-\d{2}-\d{2}$' or to_char(to_date(due_date,'YYYY-MM-DD'),'YYYY-MM-DD') <> due_date) then return false; end if;
  if jsonb_typeof(policy->'dueMiles') not in ('null','number') then return false; end if;
  if jsonb_typeof(policy->'baselineMiles') not in ('null','number') then return false; end if;
  if jsonb_typeof(policy->'additionalMiles') not in ('null','number') then return false; end if;
  due_miles := nullif(policy->>'dueMiles','')::numeric;
  baseline_miles := nullif(policy->>'baselineMiles','')::numeric;
  additional_miles := nullif(policy->>'additionalMiles','')::numeric;
  if due_miles is not null and due_miles not between 0 and 99999999.9 then return false; end if;
  if baseline_miles is not null and baseline_miles not between 0 and 99999999.9 then return false; end if;
  if additional_miles is not null and (additional_miles <= 0 or baseline_miles is null or due_miles is null or due_miles <> baseline_miles + additional_miles) then return false; end if;
  if policy->>'nextVisit' <> 'true' and due_date is null and due_miles is null then return false; end if;
  if policy ? 'reviewedAt' and jsonb_typeof(policy->'reviewedAt') <> 'string' then return false; end if;
  if policy ? 'reviewedAt' then perform (policy->>'reviewedAt')::timestamptz; end if;
  return true;
exception when others then
  return false;
end $$;

alter table inspection_findings
  add column deferral_policy jsonb,
  add column maintenance_obligation_id uuid;

alter table inspection_findings drop constraint inspection_findings_disposition_check;
alter table inspection_findings add constraint inspection_findings_disposition_check
  check (disposition in ('new_workorder','linked_workorder','office_follow_up','no_workorder','defer'));
alter table inspection_findings add constraint inspection_finding_deferral_shape check (
  (disposition <> 'defer' and deferral_policy is null and maintenance_obligation_id is null)
  or (
    disposition = 'defer'
    and severity = 'attention'
    and maintenance_obligation_id is not null
    and inspection_deferral_policy_valid(deferral_policy)
  )
);
create index inspection_findings_maintenance_obligation_idx
  on inspection_findings(company_id,maintenance_obligation_id) where maintenance_obligation_id is not null;

alter table inspection_finding_follow_ups
  add column deferral_policy jsonb,
  add column maintenance_obligation_id uuid,
  add column defer_count integer not null default 0 check(defer_count >= 0);

alter table inspection_finding_follow_ups drop constraint inspection_finding_follow_ups_status_check;
alter table inspection_finding_follow_ups add constraint inspection_finding_follow_ups_status_check
  check (status in ('open','resolved_workorder','resolved_no_workorder','reopened','superseded'));
alter table inspection_finding_follow_ups drop constraint inspection_follow_up_shape;
alter table inspection_finding_follow_ups add constraint inspection_follow_up_shape check (
  (status = 'open' and workorder_id is null and resolution_reason = '' and resolved_at is null and resolved_by_user_id is null)
  or (status = 'resolved_workorder' and workorder_id is not null and resolution_reason = '' and resolved_at is not null and resolved_by_user_id is not null)
  or (status = 'resolved_no_workorder' and workorder_id is null and btrim(resolution_reason) <> '' and resolved_at is not null and resolved_by_user_id is not null)
  or (status = 'reopened' and workorder_id is not null and resolved_at is null and resolved_by_user_id is null)
  or (status = 'superseded' and resolved_at is not null and resolved_by_user_id is not null)
);
alter table inspection_finding_follow_ups add constraint inspection_follow_up_deferral_shape check (
  (deferral_policy is null and maintenance_obligation_id is null and defer_count = 0)
  or (
    deferral_policy is not null
    and maintenance_obligation_id is not null
    and defer_count > 0
    and inspection_deferral_policy_valid(deferral_policy)
  )
);
create unique index inspection_follow_up_active_obligation_uidx
  on inspection_finding_follow_ups(company_id,maintenance_obligation_id)
  where maintenance_obligation_id is not null and status <> 'superseded';
create index inspection_follow_up_asset_maintenance_idx
  on inspection_finding_follow_ups(company_id,updated_at desc,id desc)
  where maintenance_obligation_id is not null and status <> 'superseded';

create function enforce_inspection_deferral_unit_support()
returns trigger language plpgsql as $$
declare target_unit_type text;
begin
  if new.disposition = 'defer' then
    select unit_type into target_unit_type from inspections where company_id=new.company_id and id=new.inspection_id;
    if target_unit_type = 'Trailer' and (jsonb_typeof(new.deferral_policy->'dueMiles')='number' or jsonb_typeof(new.deferral_policy->'baselineMiles')='number' or jsonb_typeof(new.deferral_policy->'additionalMiles')='number') then
      raise exception 'Trailer deferrals support next visit or date only.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger inspection_findings_deferral_unit_support
  before insert or update of disposition,deferral_policy on inspection_findings
  for each row execute function enforce_inspection_deferral_unit_support();

alter table inspection_finding_follow_up_events drop constraint inspection_finding_follow_up_events_event_type_check;
alter table inspection_finding_follow_up_events add constraint inspection_finding_follow_up_events_event_type_check
  check(event_type in ('opened','resolved_workorder','resolved_no_workorder','reopened','deferred','verified','superseded'));

alter table inspection_follow_up_commands drop constraint inspection_follow_up_commands_action_check;
alter table inspection_follow_up_commands add constraint inspection_follow_up_commands_action_check
  check(action in ('link_workorder','create_workorder','no_workorder','defer','verify'));

comment on column inspection_findings.deferral_policy is 'Canonical date, next-visit, and absolute-mileage review policy captured in inspection evidence.';
comment on column inspection_finding_follow_ups.maintenance_obligation_id is 'Stable identity shared by correction successors; at most one non-superseded maintenance follow-up exists.';

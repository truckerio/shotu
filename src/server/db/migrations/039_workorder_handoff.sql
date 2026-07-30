-- Canonical mechanic/Manager handoff metadata and revision attention.

alter table operational_workorders
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by_user_id uuid references user_profiles(id) on delete set null,
  add column if not exists cancel_reason text not null default '',
  add column if not exists approved_by_user_id uuid references user_profiles(id) on delete set null;

update operational_workorders
set cancelled_at = coalesce(cancelled_at, closed_at, updated_at),
    cancel_reason = case when length(trim(cancel_reason)) >= 2 then cancel_reason else 'Legacy cancellation.' end
where status = 'cancelled';

alter table workorder_attention_state
  drop constraint if exists workorder_attention_state_reason_check;

alter table workorder_attention_state
  add constraint workorder_attention_state_reason_check
  check (reason in ('parts', 'office_help', 'missing_info', 'revision_requested'));

alter table workorder_attention_events
  drop constraint if exists workorder_attention_events_reason_check;

alter table workorder_attention_events
  add constraint workorder_attention_events_reason_check
  check (reason in ('parts', 'office_help', 'missing_info', 'revision_requested'));

alter table operational_workorders
  add constraint operational_workorders_cancellation_metadata_check
  check (
    (status = 'cancelled' and cancelled_at is not null and length(trim(cancel_reason)) between 2 and 1000)
    or
    (status <> 'cancelled' and cancelled_at is null and cancelled_by_user_id is null and cancel_reason = '')
  ) not valid;

alter table operational_workorders
  validate constraint operational_workorders_cancellation_metadata_check;

create index if not exists operational_workorders_approved_by_idx
  on operational_workorders(approved_by_user_id)
  where approved_by_user_id is not null;

create index if not exists operational_workorders_cancelled_by_idx
  on operational_workorders(cancelled_by_user_id)
  where cancelled_by_user_id is not null;

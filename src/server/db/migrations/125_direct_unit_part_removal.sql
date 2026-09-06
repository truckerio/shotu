set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A removal initiated from Unit detail is its own custody event. Keep the
-- installation workorder as provenance without inventing a second workorder.
alter table inventory_reuse_cases
  alter column removal_workorder_id drop not null;

comment on column inventory_reuse_cases.removal_workorder_id is
  'Optional legacy link for removals recorded on a workorder. Direct Unit-detail removals leave this null.';

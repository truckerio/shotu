set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_reuse_operations drop constraint inventory_reuse_operations_action_check;
alter table inventory_reuse_operations add constraint inventory_reuse_operations_action_check check (action in (
  'remove','receive','return','release','route','repair_start','repair_complete',
  'core_return','scrap','quarantine_resolve','legacy_track','correct_location'
));

comment on table inventory_reuse_operations is
  'Replay-safe custody commands. return atomically records physical receipt and the operator decision.';

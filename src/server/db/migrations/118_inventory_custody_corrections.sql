set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Governed holder corrections are exact-unit operations, not fabricated custody cases.
alter table inventory_reuse_operations alter column case_id drop not null;
alter table inventory_reuse_operations drop constraint inventory_reuse_operations_action_check;
alter table inventory_reuse_operations add constraint inventory_reuse_operations_action_check check (action in (
  'remove','receive','release','route','repair_start','repair_complete','core_return','scrap','quarantine_resolve','correct_location'
));
alter table inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table inventory_unit_events add constraint inventory_unit_events_event_type_check check (event_type in (
  'receipt_staged','receipt_confirmed','receipt_recorded','reconciliation_required','issued','reserved','installed_pending_approval','installed','returned','removed_returned_to_stock','removed','void',
  'reuse_received','reuse_hold','reuse_released','reuse_routed','reuse_repair_started','reuse_repair_completed','reuse_core_returned','reuse_scrapped','reuse_quarantine_resolved','reuse_location_corrected'
));

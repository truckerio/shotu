set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_receipts drop constraint inventory_receipts_provider_check;
alter table inventory_receipts add constraint inventory_receipts_provider_check
  check (provider in ('odoo','local','local_count','local_serialization','legacy_tracking'));
alter table inventory_receipts drop constraint inventory_receipts_confirmed_state;
alter table inventory_receipts add constraint inventory_receipts_confirmed_state check (
  status <> 'confirmed' or (confirmed_at is not null and (provider in ('local','local_count','local_serialization','legacy_tracking') or provider_picking_external_id is not null))
);
alter table inventory_receipts drop constraint inventory_receipts_source_check;
alter table inventory_receipts add constraint inventory_receipts_source_check check (
  (provider='local_count' and invoice_run_id is null and count_import_id is not null and serialization_batch_id is null)
  or (provider='local_serialization' and invoice_run_id is null and count_import_id is null and serialization_batch_id is not null)
  or (provider='legacy_tracking' and invoice_run_id is null and count_import_id is null and serialization_batch_id is null)
  or (provider not in ('local_count','local_serialization','legacy_tracking') and invoice_run_id is not null and count_import_id is null and serialization_batch_id is null)
);
alter table inventory_reuse_operations drop constraint inventory_reuse_operations_action_check;
alter table inventory_reuse_operations add constraint inventory_reuse_operations_action_check check (action in (
  'remove','legacy_track','receive','release','route','repair_start','repair_complete','core_return','scrap','quarantine_resolve','correct_location'
));

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Both branches own valid receipt sources; retain their evidence and constraints.
alter table inventory_receipts drop constraint inventory_receipts_provider_check;
alter table inventory_receipts add constraint inventory_receipts_provider_check
  check (provider in ('odoo','local','local_count','local_serialization','legacy_tracking','local_direct','local_manual'));
alter table inventory_receipts drop constraint inventory_receipts_confirmed_state;
alter table inventory_receipts add constraint inventory_receipts_confirmed_state check (
  status <> 'confirmed' or (confirmed_at is not null and (provider <> 'odoo' or provider_picking_external_id is not null))
);
alter table inventory_receipts drop constraint inventory_receipts_source_check;
alter table inventory_receipts add constraint inventory_receipts_source_check check (
  (provider='local_count' and invoice_run_id is null and count_import_id is not null and serialization_batch_id is null and manual_intake_batch_id is null)
  or (provider='local_serialization' and invoice_run_id is null and count_import_id is null and serialization_batch_id is not null and manual_intake_batch_id is null)
  or (provider='local_manual' and invoice_run_id is null and count_import_id is null and serialization_batch_id is null and manual_intake_batch_id is not null)
  or (provider in ('legacy_tracking','local_direct') and invoice_run_id is null and count_import_id is null and serialization_batch_id is null and manual_intake_batch_id is null)
  or (provider in ('odoo','local') and invoice_run_id is not null and count_import_id is null and serialization_batch_id is null and manual_intake_batch_id is null)
);
alter table inventory_stock_movements drop constraint inventory_stock_movements_movement_type_check;
alter table inventory_stock_movements add constraint inventory_stock_movements_movement_type_check
  check (movement_type in ('invoice_receipt','manual_receipt','direct_receipt','receipt_reversal','issue','return','transfer_in','transfer_out','adjustment'));
alter table inventory_receipt_lines drop constraint inventory_receipt_lines_quantity_check;
alter table inventory_receipt_lines add constraint inventory_receipt_lines_quantity_check check (
  quantity > 0 and quantity <= 999999.999
  and (tracking_mode <> 'serial' or (quantity = trunc(quantity) and quantity <= 1000))
);

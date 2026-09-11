set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_manual_intake_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  quantity numeric(14,3) not null check (quantity > 0 and quantity <= 999999.999),
  uom_code text not null references units_of_measure(code),
  tracking_mode varchar(24) not null check (tracking_mode in ('quantity','measured_bulk')),
  physical_confirmation varchar(48) not null check (physical_confirmation = 'physically_present_at_location'),
  created_at timestamptz not null default now(),
  constraint inventory_manual_intake_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_manual_intake_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  unique (company_id, created_by, idempotency_key),
  unique (company_id, id)
);

create index inventory_manual_intake_part_history_idx
  on inventory_manual_intake_batches (company_id, catalog_part_id, location_id, created_at desc, id);

alter table inventory_receipt_lines
  drop constraint inventory_receipt_lines_quantity_check,
  alter column quantity type numeric(14,3) using quantity::numeric,
  add constraint inventory_receipt_lines_quantity_check
    check (quantity > 0 and quantity <= 999999.999);

alter table inventory_receipts add column manual_intake_batch_id uuid;
alter table inventory_receipts drop constraint inventory_receipts_provider_check;
alter table inventory_receipts add constraint inventory_receipts_provider_check
  check (provider in ('odoo','local','local_count','local_serialization','legacy_tracking','local_manual'));
alter table inventory_receipts drop constraint inventory_receipts_confirmed_state;
alter table inventory_receipts add constraint inventory_receipts_confirmed_state check (
  status <> 'confirmed' or (confirmed_at is not null and (provider in ('local','local_count','local_serialization','legacy_tracking','local_manual') or provider_picking_external_id is not null))
);
alter table inventory_receipts drop constraint inventory_receipts_source_check;
alter table inventory_receipts add constraint inventory_receipts_source_check check (
  (provider='local_count' and invoice_run_id is null and count_import_id is not null and serialization_batch_id is null and manual_intake_batch_id is null)
  or (provider='local_serialization' and invoice_run_id is null and count_import_id is null and serialization_batch_id is not null and manual_intake_batch_id is null)
  or (provider='local_manual' and invoice_run_id is null and count_import_id is null and serialization_batch_id is null and manual_intake_batch_id is not null)
  or (provider='legacy_tracking' and invoice_run_id is null and count_import_id is null and serialization_batch_id is null and manual_intake_batch_id is null)
  or (provider not in ('local_count','local_serialization','legacy_tracking','local_manual') and invoice_run_id is not null and count_import_id is null and serialization_batch_id is null and manual_intake_batch_id is null)
), add constraint inventory_receipts_manual_intake_company_fk
  foreign key (company_id, manual_intake_batch_id)
  references inventory_manual_intake_batches(company_id, id) on delete restrict;

alter table inventory_stock_movements drop constraint inventory_stock_movements_movement_type_check;
alter table inventory_stock_movements add constraint inventory_stock_movements_movement_type_check check (
  movement_type in ('invoice_receipt','manual_receipt','receipt_reversal','issue','return','transfer_in','transfer_out','adjustment')
);

alter table workorder_aggregate_part_usages
  add column tracking_mode varchar(24);
update workorder_aggregate_part_usages set tracking_mode='measured_bulk' where tracking_mode is null;
alter table workorder_aggregate_part_usages
  alter column tracking_mode set not null,
  add constraint workorder_aggregate_usage_tracking_mode_check
    check (tracking_mode in ('quantity','measured_bulk')),
  add constraint workorder_aggregate_usage_quantity_scale_check
    check (tracking_mode <> 'quantity' or (quantity=trunc(quantity) and adjustment_total=trunc(adjustment_total)));

comment on table inventory_manual_intake_batches is
  'Idempotent physical intake evidence for application-owned aggregate inventory.';
comment on column inventory_receipts.manual_intake_batch_id is
  'Manual physical-intake source for quantity or measured-bulk receipt lines.';
comment on column workorder_aggregate_part_usages.tracking_mode is
  'Saved aggregate policy at reservation time; quantity usage remains whole-number at the persistence boundary.';

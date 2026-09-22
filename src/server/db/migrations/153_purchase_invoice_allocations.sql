set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table local_inventory_receipts
  add column posting_route text not null default 'no_purchase_order'
    check (posting_route in ('purchase_order','no_purchase_order')),
  add column no_purchase_order_reason text not null default 'Legacy receipt before explicit PO routing';
alter table local_inventory_receipts add constraint local_inventory_receipts_no_po_reason_required check (
  posting_route <> 'no_purchase_order' or length(trim(no_purchase_order_reason)) > 0 or source_type = 'direct'
);

create table inventory_purchase_invoice_allocations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  invoice_run_id uuid not null,
  invoice_line_index integer not null check (invoice_line_index >= 0),
  purchase_line_id uuid not null,
  receipt_line_id uuid,
  quantity numeric(14,3) not null check (quantity > 0),
  status text not null default 'planned' check (status in ('planned','posted','released')),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  posted_at timestamptz,
  foreign key (company_id, invoice_run_id) references invoice_extraction_runs(company_id,id) on delete restrict,
  foreign key (company_id, purchase_line_id) references inventory_purchase_lines(company_id,id) on delete restrict,
  foreign key (company_id, receipt_line_id) references inventory_receipt_lines(company_id,id) on delete restrict,
  check ((status = 'posted' and receipt_line_id is not null and posted_at is not null) or (status <> 'posted' and posted_at is null)),
  unique (company_id, invoice_run_id, invoice_line_index, purchase_line_id)
);

create index inventory_purchase_invoice_allocations_run
  on inventory_purchase_invoice_allocations(company_id, invoice_run_id, invoice_line_index);
create index inventory_purchase_invoice_allocations_line
  on inventory_purchase_invoice_allocations(company_id, purchase_line_id, status);

comment on table inventory_purchase_invoice_allocations is
  'Reviewed, tenant-scoped invoice-to-PO allocation plan. Posting is atomic with the canonical local receipt.';

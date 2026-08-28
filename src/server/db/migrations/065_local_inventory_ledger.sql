set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table local_inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  invoice_run_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status varchar(24) not null default 'posted' check (status in ('posted', 'reversed')),
  line_count integer not null check (line_count between 1 and 500),
  total_quantity numeric(14, 3) not null check (total_quantity > 0),
  posted_at timestamptz not null default now(),
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint local_inventory_receipts_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint local_inventory_receipts_invoice_company_fk
    foreign key (company_id, invoice_run_id) references invoice_extraction_runs(company_id, id) on delete restrict,
  constraint local_inventory_receipts_reversal_state check (
    (status = 'reversed' and reversed_at is not null) or
    (status = 'posted' and reversed_at is null)
  ),
  unique (company_id, invoice_run_id),
  unique (company_id, created_by, idempotency_key),
  unique (company_id, id)
);

create table local_inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  receipt_id uuid not null,
  line_index integer not null check (line_index >= 0),
  catalog_part_id uuid not null,
  normalized_part_number text not null check (btrim(normalized_part_number) <> ''),
  part_number varchar(200) not null check (btrim(part_number) <> ''),
  description varchar(1000) not null default '',
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 999999.999),
  uom_code text not null references units_of_measure(code),
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  line_total numeric(14, 2) check (line_total is null or line_total >= 0),
  created_at timestamptz not null default now(),
  constraint local_inventory_receipt_lines_receipt_company_fk
    foreign key (company_id, receipt_id) references local_inventory_receipts(company_id, id) on delete restrict,
  constraint local_inventory_receipt_lines_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  unique (company_id, receipt_id, line_index),
  unique (company_id, id)
);

create table inventory_stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  receipt_id uuid,
  receipt_line_id uuid,
  movement_type varchar(32) not null check (
    movement_type in ('invoice_receipt', 'receipt_reversal', 'issue', 'return', 'transfer_in', 'transfer_out', 'adjustment')
  ),
  quantity_delta numeric(14, 3) not null check (quantity_delta <> 0),
  uom_code text not null references units_of_measure(code),
  actor_id uuid references user_profiles(id) on delete restrict,
  reason varchar(500) not null default '',
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  created_at timestamptz not null default now(),
  constraint inventory_stock_movements_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_stock_movements_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint inventory_stock_movements_receipt_company_fk
    foreign key (company_id, receipt_id) references local_inventory_receipts(company_id, id) on delete restrict,
  constraint inventory_stock_movements_line_company_fk
    foreign key (company_id, receipt_line_id) references local_inventory_receipt_lines(company_id, id) on delete restrict,
  unique (company_id, idempotency_key),
  unique (company_id, id)
);

create index local_inventory_receipts_history_idx
  on local_inventory_receipts (company_id, location_id, posted_at desc, id);
create index local_inventory_receipt_lines_part_idx
  on local_inventory_receipt_lines (company_id, catalog_part_id, created_at desc, id);
create index inventory_stock_movements_part_history_idx
  on inventory_stock_movements (company_id, catalog_part_id, location_id, created_at desc, id);
create index inventory_items_local_stock_idx
  on inventory_items (company_id, location_id, updated_at desc, id)
  where source_provider = 'local';

comment on table local_inventory_receipts is
  'Idempotent application-owned posting of one reviewed invoice into local stock.';
comment on table inventory_stock_movements is
  'Append-only local inventory audit ledger. Corrections use compensating movements.';
comment on index inventory_items_local_stock_idx is
  'Supports bounded local-authority stock screens without scanning provider projections.';

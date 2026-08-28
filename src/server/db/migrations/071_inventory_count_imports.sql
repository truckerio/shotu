set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_count_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  source_file_name varchar(240) not null check (btrim(source_file_name) <> ''),
  source_sha256 char(64) not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  status varchar(24) not null default 'draft' check (status in ('draft', 'partial', 'applied', 'cancelled')),
  row_count integer not null check (row_count between 1 and 500),
  ready_count integer not null default 0 check (ready_count between 0 and row_count),
  exception_count integer not null default 0 check (exception_count between 0 and row_count),
  applied_count integer not null default 0 check (applied_count between 0 and row_count),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  constraint inventory_count_imports_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_count_imports_state_check check (
    (status = 'applied' and applied_at is not null and applied_count > 0)
    or (status <> 'applied')
  ),
  unique (company_id, location_id, source_sha256),
  unique (company_id, id)
);

alter table inventory_receipts
  alter column invoice_run_id drop not null,
  add column count_import_id uuid;

alter table inventory_receipts drop constraint inventory_receipts_provider_check;
alter table inventory_receipts
  add constraint inventory_receipts_provider_check
  check (provider in ('odoo', 'local', 'local_count'));

alter table inventory_receipts drop constraint inventory_receipts_confirmed_state;
alter table inventory_receipts
  add constraint inventory_receipts_confirmed_state check (
    status <> 'confirmed'
    or (
      confirmed_at is not null
      and (provider in ('local', 'local_count') or provider_picking_external_id is not null)
    )
  ),
  add constraint inventory_receipts_source_check check (
    (provider = 'local_count' and invoice_run_id is null and count_import_id is not null)
    or (provider <> 'local_count' and invoice_run_id is not null and count_import_id is null)
  ),
  add constraint inventory_receipts_count_import_company_fk
    foreign key (company_id, count_import_id)
    references inventory_count_imports(company_id, id) on delete restrict;

create table inventory_count_import_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  import_id uuid not null,
  source_row integer not null check (source_row between 1 and 10000),
  source_part_number varchar(240) not null check (btrim(source_part_number) <> ''),
  source_part_name varchar(500) not null default '',
  source_description varchar(1000) not null default '',
  source_bin_location varchar(120) not null default '',
  source_quantity_text varchar(120) not null default '',
  quantity integer check (quantity between 1 and 500),
  average_cost numeric(14, 4) check (average_cost is null or average_cost >= 0),
  catalog_part_id uuid,
  match_status varchar(24) not null check (
    match_status in ('ready', 'unmatched', 'duplicate', 'invalid_quantity', 'ignored', 'applied')
  ),
  resolution_source varchar(24) not null check (resolution_source in ('exact', 'manual', 'none')),
  applied_receipt_id uuid,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_count_import_lines_import_company_fk
    foreign key (company_id, import_id) references inventory_count_imports(company_id, id) on delete restrict,
  constraint inventory_count_import_lines_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint inventory_count_import_lines_receipt_company_fk
    foreign key (company_id, applied_receipt_id) references inventory_receipts(company_id, id) on delete restrict,
  constraint inventory_count_import_lines_match_state check (
    (match_status in ('ready', 'applied') and catalog_part_id is not null and quantity is not null)
    or (match_status not in ('ready', 'applied'))
  ),
  constraint inventory_count_import_lines_applied_state check (
    (match_status = 'applied' and applied_receipt_id is not null and applied_at is not null)
    or (match_status <> 'applied' and applied_receipt_id is null and applied_at is null)
  ),
  unique (company_id, import_id, source_row),
  unique (company_id, id)
);

create unique index inventory_count_import_lines_ready_part_idx
  on inventory_count_import_lines (company_id, import_id, catalog_part_id)
  where match_status in ('ready', 'applied');
create index inventory_count_imports_location_created_idx
  on inventory_count_imports (company_id, location_id, created_at desc, id);
create index inventory_count_import_lines_review_idx
  on inventory_count_import_lines (company_id, import_id, match_status, source_row, id);

alter table inventory_label_batches drop constraint inventory_label_batches_receipt_company_fk;
alter table inventory_label_batches
  add constraint inventory_label_batches_receipt_company_fk
    foreign key (company_id, receipt_id) references inventory_receipts(company_id, id) on delete restrict;
alter table inventory_label_batches drop constraint inventory_label_batches_purpose_check;
alter table inventory_label_batches
  add constraint inventory_label_batches_purpose_check
    check (purpose in ('receipt', 'stock_count'));

comment on table inventory_count_imports is
  'Reviewable, idempotent location stock-count imports; uploading never changes stock.';
comment on table inventory_count_import_lines is
  'Original spreadsheet evidence and explicit master-part resolution for an inventory count.';
comment on column inventory_receipts.count_import_id is
  'Opening-count source. local_count receipts have no seller invoice.';

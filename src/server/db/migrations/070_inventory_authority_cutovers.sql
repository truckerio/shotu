set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_authority_cutovers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  inventory_item_id uuid not null,
  receipt_id uuid not null,
  receipt_line_id uuid not null,
  previous_source_provider text not null check (
    btrim(previous_source_provider) <> '' and previous_source_provider <> 'local'
  ),
  previous_external_id text not null default '',
  previous_quantity_on_hand numeric(14, 3) not null check (previous_quantity_on_hand >= 0),
  previous_quantity_reserved numeric(14, 3) not null check (previous_quantity_reserved = 0),
  previous_provider_updated_at timestamptz,
  previous_last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  constraint inventory_authority_cutovers_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_authority_cutovers_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint inventory_authority_cutovers_item_company_fk
    foreign key (company_id, inventory_item_id) references inventory_items(company_id, id) on delete restrict,
  constraint inventory_authority_cutovers_receipt_company_fk
    foreign key (company_id, receipt_id) references local_inventory_receipts(company_id, id) on delete restrict,
  constraint inventory_authority_cutovers_line_company_fk
    foreign key (company_id, receipt_line_id) references local_inventory_receipt_lines(company_id, id) on delete restrict,
  unique (company_id, receipt_line_id),
  unique (company_id, id)
);

create index inventory_authority_cutovers_history_idx
  on inventory_authority_cutovers (company_id, location_id, created_at desc, id);

comment on table inventory_authority_cutovers is
  'Immutable snapshot of an unreserved provider projection replaced by the first physically confirmed local receipt.';

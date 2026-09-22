set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Read-only snapshots of confirmed Odoo purchase orders. These rows provide
-- commercial evidence only; inventory_receipts and inventory_stock_movements
-- remain the sole owners of local quantity.
create table odoo_purchase_history_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  external_id text not null,
  reference text not null default '',
  status text not null default '',
  vendor_external_id text not null default '',
  vendor_name text not null default '',
  currency text not null default '',
  ordered_at timestamptz,
  approved_at timestamptz,
  amount_total numeric(18, 4),
  source_updated_at timestamptz,
  raw_payload jsonb not null default '{}',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, external_id),
  unique (company_id, id)
);

create table odoo_purchase_history_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  purchase_order_id uuid not null,
  external_id text not null,
  sequence numeric(14, 4) not null default 0,
  product_external_id text not null default '',
  catalog_part_id uuid,
  description text not null default '',
  ordered_quantity numeric(18, 4),
  received_quantity numeric(18, 4),
  invoiced_quantity numeric(18, 4),
  uom text not null default '',
  unit_price numeric(18, 4),
  subtotal numeric(18, 4),
  total numeric(18, 4),
  planned_at timestamptz,
  source_updated_at timestamptz,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_purchase_history_lines_order_company_fkey
    foreign key (company_id, purchase_order_id)
    references odoo_purchase_history_orders(company_id, id)
    on delete cascade,
  constraint odoo_purchase_history_lines_catalog_company_fkey
    foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id)
    on delete set null (catalog_part_id),
  unique (company_id, purchase_order_id, external_id)
);

create index odoo_purchase_history_orders_company_date_idx
  on odoo_purchase_history_orders(company_id, coalesce(approved_at, ordered_at) desc, id);

create index odoo_purchase_history_lines_part_date_idx
  on odoo_purchase_history_lines(company_id, catalog_part_id, purchase_order_id)
  where catalog_part_id is not null;

comment on table odoo_purchase_history_orders is
  'Read-only confirmed Odoo purchase-order headers; never inventory quantity authority.';
comment on table odoo_purchase_history_lines is
  'Read-only Odoo purchase-order line and price history mapped through stable Odoo product identity.';

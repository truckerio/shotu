set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_suppliers (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  name text not null check(length(trim(name)) between 1 and 240), contact text not null default '',
  active boolean not null default true, created_at timestamptz not null default now(),
  unique(company_id,id)
);
create unique index inventory_supplier_name on inventory_suppliers(company_id,lower(trim(name)));
create table inventory_purchase_orders (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references companies(id),
  location_id uuid not null, supplier_id uuid not null, created_by uuid not null references user_profiles(id),
  number text not null, currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
  status text not null default 'draft' check(status in ('draft','pending_approval','ordered','partially_received','received','cancelled')),
  version integer not null default 1, notes text not null default '', communication_reference text not null default '',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(company_id,location_id) references locations(company_id,id),
  foreign key(company_id,supplier_id) references inventory_suppliers(company_id,id),
  unique(company_id,id), unique(company_id,number)
);
create table inventory_purchase_lines (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, order_id uuid not null,
  catalog_part_id uuid not null, part_number text not null, description text not null,
  uom_code text not null references units_of_measure(code),
  quantity numeric(14,3) not null check(quantity > 0), received_quantity numeric(14,3) not null default 0 check(received_quantity >= 0),
  cancelled_quantity numeric(14,3) not null default 0 check(cancelled_quantity >= 0),
  unit_price numeric(14,4) check(unit_price is null or unit_price >= 0),
  foreign key(company_id,order_id) references inventory_purchase_orders(company_id,id),
  foreign key(company_id,catalog_part_id) references parts_catalog(company_id,id),
  check(received_quantity+cancelled_quantity <= quantity), unique(company_id,id)
);
create table inventory_purchase_receipt_allocations (
  company_id uuid not null, purchase_line_id uuid not null, receipt_line_id uuid not null,
  quantity numeric(14,3) not null check(quantity > 0),
  foreign key(company_id,purchase_line_id) references inventory_purchase_lines(company_id,id),
  foreign key(company_id,receipt_line_id) references inventory_receipt_lines(company_id,id),
  primary key(company_id,receipt_line_id)
);
create table inventory_workflow_commands (
  company_id uuid not null references companies(id), actor_id uuid not null references user_profiles(id),
  location_id uuid not null, foreign key(company_id,location_id) references locations(company_id,id),
  idempotency_key uuid not null, request_hash char(64) not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key(company_id,actor_id,idempotency_key)
);
create table inventory_purchase_events (
  id uuid primary key default gen_random_uuid(), company_id uuid not null, order_id uuid not null,
  actor_id uuid not null references user_profiles(id), action text not null, details jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references inventory_purchase_orders(company_id,id)
);
create index inventory_purchase_queue on inventory_purchase_orders(company_id,location_id,status,created_at desc);

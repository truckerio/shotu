set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table inventory_supplier_bills (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),location_id uuid not null,supplier_id uuid not null,
 reference text not null check(length(trim(reference)) between 1 and 240),currency char(3) not null check(currency ~ '^[A-Z]{3}$'),
 subtotal numeric(14,2) not null check(subtotal>=0),tax numeric(14,2) not null check(tax>=0),
 paid numeric(14,2) not null default 0 check(paid>=0),credited numeric(14,2) not null default 0 check(credited>=0),
 due_date date not null,notes text not null default '',version integer not null default 1,
 created_by uuid not null references user_profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(company_id,location_id) references locations(company_id,id),foreign key(company_id,supplier_id) references inventory_suppliers(company_id,id),
 unique(company_id,id),check(paid+credited<=subtotal+tax)
);
create unique index inventory_supplier_bill_reference on inventory_supplier_bills(company_id,supplier_id,lower(trim(reference)));
create table inventory_bill_receipt_allocations (
 company_id uuid not null,bill_id uuid not null,receipt_line_id uuid not null,quantity numeric(14,3) not null check(quantity>0),
 foreign key(company_id,bill_id) references inventory_supplier_bills(company_id,id),foreign key(company_id,receipt_line_id) references inventory_receipt_lines(company_id,id),
 primary key(company_id,bill_id,receipt_line_id)
);
create table inventory_bill_events (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,bill_id uuid not null,
 actor_id uuid not null references user_profiles(id),action text not null check(action in ('create','match','payment','credit')),
 amount numeric(14,2),reference text not null,details jsonb not null,created_at timestamptz not null default now(),
 foreign key(company_id,bill_id) references inventory_supplier_bills(company_id,id)
);
create index inventory_supplier_bill_due on inventory_supplier_bills(company_id,location_id,due_date);

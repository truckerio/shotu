set local lock_timeout = '5s';
set local statement_timeout = '60s';
create table inventory_stock_tasks (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references companies(id),
 location_id uuid not null,destination_id uuid,catalog_part_id uuid not null,
 kind text not null check(kind in ('damage','transfer','count')),
 status text not null check(status in ('inspection','repair','in_transit','received','awaiting_approval','recount','approved','released','scrapped','cancelled')),
 quantity numeric(14,3) not null check(quantity>=0),completed_quantity numeric(14,3) not null default 0 check(completed_quantity>=0 and completed_quantity<=quantity),
 uom_code text not null references units_of_measure(code),reason text not null,
 holder text not null default '',balance_revision text,observed_balance numeric(14,3),
 version integer not null default 1,created_by uuid not null references user_profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(company_id,location_id) references locations(company_id,id),
 foreign key(company_id,destination_id) references locations(company_id,id),
 foreign key(company_id,catalog_part_id) references parts_catalog(company_id,id),unique(company_id,id),
 check((kind='transfer' and destination_id is not null and destination_id<>location_id) or (kind<>'transfer' and destination_id is null))
);
create table inventory_stock_task_units (
 company_id uuid not null,task_id uuid not null,unit_id uuid not null,received_at timestamptz,
 foreign key(company_id,task_id) references inventory_stock_tasks(company_id,id),
 foreign key(company_id,unit_id) references inventory_serialized_units(company_id,id),primary key(company_id,task_id,unit_id)
);
create table inventory_stock_task_events (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,task_id uuid not null,
 actor_id uuid not null references user_profiles(id),action text not null,details jsonb not null,
 created_at timestamptz not null default now(),foreign key(company_id,task_id) references inventory_stock_tasks(company_id,id)
);
create index inventory_stock_task_queue on inventory_stock_tasks(company_id,location_id,kind,status,created_at desc);
create index inventory_stock_task_destination on inventory_stock_tasks(company_id,destination_id,status);

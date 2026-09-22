set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_stock_tasks
 add column tracking_snapshot text,
 add column blind_receiving boolean not null default false,
 add column source_provenance jsonb not null default '{}',
 add column source_allocations jsonb not null default '[]',
 add column transfer_state text check (transfer_state in ('in_transit','returning','completed')),
 add column lost_quantity numeric(14,3) not null default 0 check (lost_quantity>=0),
 add column returned_quantity numeric(14,3) not null default 0 check (returned_quantity>=0),
 add column parent_transfer_id uuid,
 add column hold_position_id uuid,
 add foreign key(company_id,parent_transfer_id) references inventory_stock_tasks(company_id,id),
 add foreign key(company_id,hold_position_id) references inventory_positions(company_id,id);

alter table inventory_stock_tasks add constraint inventory_transfer_resolved_quantities check(returned_quantity+lost_quantity<=completed_quantity);
alter table inventory_stock_task_units add column transfer_disposition text check(transfer_disposition in ('received','damaged','returned','lost'));

update inventory_stock_tasks t set tracking_snapshot=p.tracking_mode
 from parts_catalog p where p.company_id=t.company_id and p.id=t.catalog_part_id;
update inventory_stock_tasks set transfer_state=case when status in ('received','cancelled') then 'completed' else 'in_transit' end where kind='transfer';

create table inventory_transfer_discrepancies (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,task_id uuid not null,
 kind text not null check(kind in ('short','extra')),
 quantity numeric(14,3) not null check(quantity>0),serial_numbers jsonb not null default '[]',
 hold_position_id uuid,reason text not null,holder text not null,
 status text not null default 'open' check(status in ('open','resolved')),
 resolution_type text check (resolution_type in ('received_or_returned','lost_in_transit','extra_returned')),
 resolution_reference text,resolved_by uuid references user_profiles(id),resolved_at timestamptz,
 created_by uuid not null references user_profiles(id),created_at timestamptz not null default now(),
 foreign key(company_id,task_id) references inventory_stock_tasks(company_id,id),
 foreign key(company_id,hold_position_id) references inventory_positions(company_id,id),
 check(kind<>'extra' or hold_position_id is not null),
 check((status='open' and resolved_at is null) or (status='resolved' and resolved_at is not null and resolution_reference is not null))
);
create index inventory_transfer_discrepancies_open on inventory_transfer_discrepancies(company_id,task_id) where status='open';

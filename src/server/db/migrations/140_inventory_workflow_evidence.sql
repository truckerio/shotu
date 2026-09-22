set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table local_inventory_receipts drop constraint local_inventory_receipts_confirmation_check;
alter table local_inventory_receipts add constraint local_inventory_receipts_confirmation_check check(physical_confirmation in ('all_received_undamaged','received_on_hold','legacy_post'));
alter table local_inventory_receipts add column disposition text not null default 'accepted' check(disposition in ('accepted','held'));
update local_inventory_receipts r set disposition='held',physical_confirmation='received_on_hold' where exists(select 1 from inventory_stock_task_events e where e.company_id=r.company_id and e.action='damaged_delivery' and e.details->>'receiptId'=r.id::text);
alter table inventory_stock_movements add column stock_task_id uuid;
alter table inventory_stock_movements add constraint inventory_stock_movements_task_fk foreign key(company_id,stock_task_id) references inventory_stock_tasks(company_id,id);

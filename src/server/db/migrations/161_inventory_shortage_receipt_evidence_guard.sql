set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table local_inventory_receipts
  drop constraint if exists local_inventory_receipts_line_count_check,
  drop constraint if exists local_inventory_receipts_total_quantity_check;

alter table local_inventory_receipts
  add constraint local_inventory_receipts_quantity_shape_check check(
    (line_count=0 and total_quantity=0)
    or (line_count between 1 and 500 and total_quantity>0)
  );

create or replace function guard_zero_line_receipt_shortage_evidence() returns trigger language plpgsql as $$
begin
  if new.line_count=0 and not exists (
    select 1
    from inventory_purchase_deliveries delivery
    join inventory_purchase_delivery_lines line
      on line.company_id=delivery.company_id and line.delivery_id=delivery.id
    where delivery.company_id=new.company_id
      and delivery.received_by=new.created_by
      and delivery.idempotency_key=new.idempotency_key
      and delivery.status='posted'
      and line.outcome='shortage'
  ) then
    raise exception 'A zero-line receipt requires durable shortage evidence.' using errcode='23514';
  end if;
  return new;
end $$;

drop trigger if exists local_inventory_zero_line_shortage_guard on local_inventory_receipts;
create constraint trigger local_inventory_zero_line_shortage_guard
after insert or update of line_count,total_quantity on local_inventory_receipts
deferrable initially deferred
for each row execute function guard_zero_line_receipt_shortage_evidence();

comment on function guard_zero_line_receipt_shortage_evidence() is
  'Allows a zero-stock receipt only when the same posting records durable shortage evidence.';

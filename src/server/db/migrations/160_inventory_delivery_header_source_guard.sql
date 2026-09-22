set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function guard_inventory_purchase_delivery_header_source() returns trigger language plpgsql as $$
declare
  source_location_id uuid;
begin
  if new.order_id is not null then
    select location_id into source_location_id
    from inventory_purchase_orders
    where company_id=new.company_id and id=new.order_id;
    if source_location_id is null or source_location_id<>new.location_id then
      raise exception 'Purchase delivery order belongs to a different location.' using errcode='23514';
    end if;
  end if;
  if new.invoice_run_id is not null then
    select location_id into source_location_id
    from invoice_extraction_runs
    where company_id=new.company_id and id=new.invoice_run_id;
    if source_location_id is null or source_location_id<>new.location_id then
      raise exception 'Purchase delivery invoice belongs to a different location.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists inventory_purchase_delivery_header_source_guard on inventory_purchase_deliveries;
create trigger inventory_purchase_delivery_header_source_guard
before insert or update of company_id,order_id,invoice_run_id,location_id on inventory_purchase_deliveries
for each row execute function guard_inventory_purchase_delivery_header_source();

comment on function guard_inventory_purchase_delivery_header_source() is
  'Keeps delivery headers in the same company and location as their purchase order and reviewed invoice sources.';

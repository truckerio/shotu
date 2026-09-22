set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function validate_inventory_purchase_delivery_line() returns trigger language plpgsql as $$
declare delivery_order_id uuid;
declare delivery_invoice_run_id uuid;
declare delivery_location_id uuid;
declare purchase_order_id uuid;
declare purchase_order_location_id uuid;
declare invoice_location_id uuid;
declare receipt_location_id uuid;
begin
  select delivery.order_id,delivery.invoice_run_id,delivery.location_id
    into delivery_order_id,delivery_invoice_run_id,delivery_location_id
  from inventory_purchase_deliveries delivery
  where delivery.company_id=new.company_id and delivery.id=new.delivery_id for key share;
  if new.purchase_line_id is not null then
    select line.order_id,purchase_order.location_id into purchase_order_id,purchase_order_location_id
    from inventory_purchase_lines line
    join inventory_purchase_orders purchase_order
      on purchase_order.company_id=line.company_id and purchase_order.id=line.order_id
    where line.company_id=new.company_id and line.id=new.purchase_line_id
    for key share of line,purchase_order;
    if delivery_order_id is null or purchase_order_id is distinct from delivery_order_id then
      raise exception 'Purchase delivery line does not belong to the delivery order.' using errcode='23514';
    end if;
    if purchase_order_location_id is distinct from delivery_location_id then
      raise exception 'Purchase delivery order belongs to a different location.' using errcode='23514';
    end if;
  end if;
  if new.invoice_line_index is not null then
    if delivery_invoice_run_id is null then
      raise exception 'Invoice delivery line requires an invoice source.' using errcode='23514';
    end if;
    select run.location_id into invoice_location_id from invoice_extraction_runs run
    where run.company_id=new.company_id and run.id=delivery_invoice_run_id for key share;
    if invoice_location_id is distinct from delivery_location_id then
      raise exception 'Purchase delivery invoice belongs to a different location.' using errcode='23514';
    end if;
  end if;
  if new.receipt_line_id is not null then
    select receipt.location_id into receipt_location_id
    from inventory_receipt_lines line
    join inventory_receipts receipt on receipt.company_id=line.company_id and receipt.id=line.receipt_id
    where line.company_id=new.company_id and line.id=new.receipt_line_id for key share of line,receipt;
    if receipt_location_id is distinct from delivery_location_id then
      raise exception 'Purchase delivery receipt line belongs to a different location.' using errcode='23514';
    end if;
  end if;
  return new;
end $$;

create or replace function protect_posted_purchase_invoice_allocation() returns trigger language plpgsql as $$
begin
  if tg_op='DELETE' and not exists(select 1 from companies where id=old.company_id) then
    return old;
  end if;
  if old.status='posted' then
    raise exception 'Posted purchase invoice allocations are append-only.' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

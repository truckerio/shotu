set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A receipt line is the durable physical batch. Preserve the legacy serial/aggregate
-- projection while adding the catalog policy and source-cost facts needed by new flows.
alter table inventory_receipt_lines
  add column catalog_tracking_mode varchar(24),
  add column currency char(3),
  add column unit_cost numeric(14,4),
  add column line_total numeric(14,2),
  add column cost_source varchar(24),
  add constraint inventory_receipt_lines_catalog_tracking_mode_check
    check (catalog_tracking_mode is null or catalog_tracking_mode in ('quantity','serialized','measured_bulk')),
  add constraint inventory_receipt_lines_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  add constraint inventory_receipt_lines_unit_cost_check
    check (unit_cost is null or unit_cost >= 0),
  add constraint inventory_receipt_lines_line_total_check
    check (line_total is null or line_total >= 0),
  add constraint inventory_receipt_lines_cost_source_check
    check (cost_source is null or cost_source in ('invoice_line','purchase_order','supplier_bill','manual','unknown'));

update inventory_receipt_lines line
set catalog_tracking_mode = part.tracking_mode
from parts_catalog part
where part.company_id=line.company_id and part.id=line.catalog_part_id
  and part.tracking_mode in ('quantity','serialized','measured_bulk')
  and line.catalog_tracking_mode is null;

update inventory_receipt_lines line
set unit_cost=cost.unit_cost,
    line_total=cost.line_total,
    currency=case when upper(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{currency,value}') ~ '^[A-Z]{3}$'
      and upper(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{currency,value}') not in ('UNK','XXX','ZZZ')
      then upper(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{currency,value}') else null end,
    cost_source=case when cost.unit_cost is not null or cost.line_total is not null then 'invoice_line' else 'unknown' end
from local_inventory_receipt_lines cost
join local_inventory_receipts local_receipt
  on local_receipt.company_id=cost.company_id and local_receipt.id=cost.receipt_id
left join invoice_extraction_runs run
  on run.company_id=local_receipt.company_id and run.id=local_receipt.invoice_run_id
where cost.company_id=line.company_id and cost.id=line.id;

update inventory_receipt_lines line
set unit_cost=coalesce(line.unit_cost,purchase_line.unit_price),
    line_total=coalesce(line.line_total,round(purchase_allocation.quantity*purchase_line.unit_price,2)),
    currency=coalesce(line.currency,purchase_order.currency),
    cost_source=case when line.cost_source='invoice_line' then line.cost_source else 'purchase_order' end
from inventory_purchase_receipt_allocations purchase_allocation
join inventory_purchase_lines purchase_line
  on purchase_line.company_id=purchase_allocation.company_id and purchase_line.id=purchase_allocation.purchase_line_id
join inventory_purchase_orders purchase_order
  on purchase_order.company_id=purchase_line.company_id and purchase_order.id=purchase_line.order_id
where purchase_allocation.company_id=line.company_id and purchase_allocation.receipt_line_id=line.id
  and purchase_line.unit_price is not null;

update inventory_receipt_lines set cost_source='unknown' where cost_source is null;

comment on column inventory_receipt_lines.catalog_tracking_mode is
  'Saved catalog tracking policy for this physical batch. Null is retained only for unresolved legacy evidence.';
comment on column inventory_receipt_lines.cost_source is
  'Source of the nullable receipt-line cost snapshot. Unknown never means zero.';

-- Preserve every legacy inconsistency for reconciliation. Do not delete generated
-- identities or labels because they may already have custody or Workorder history.
create table inventory_receipt_lineage_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  receipt_line_id uuid not null,
  exception_code varchar(64) not null check (exception_code in (
    'tracking_snapshot_unknown','legacy_inferred_serialization','serialized_receipt_mismatch','label_receipt_mismatch'
  )),
  evidence_key text not null default '',
  details jsonb not null default '{}'::jsonb,
  status varchar(16) not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key(company_id,receipt_line_id) references inventory_receipt_lines(company_id,id) on delete restrict,
  unique(company_id,receipt_line_id,exception_code,evidence_key)
);

insert into inventory_receipt_lineage_exceptions(company_id,receipt_line_id,exception_code,details)
select line.company_id,line.id,'tracking_snapshot_unknown',
  jsonb_build_object('legacyTrackingMode',line.tracking_mode,'catalogPartId',line.catalog_part_id)
from inventory_receipt_lines line where line.catalog_tracking_mode is null
on conflict do nothing;

insert into inventory_receipt_lineage_exceptions(company_id,receipt_line_id,exception_code,details)
select line.company_id,line.id,'legacy_inferred_serialization',
  jsonb_build_object('legacyTrackingMode',line.tracking_mode,'catalogTrackingMode',line.catalog_tracking_mode)
from inventory_receipt_lines line
where line.tracking_mode='serial' and line.catalog_tracking_mode in ('quantity','measured_bulk')
on conflict do nothing;

insert into inventory_receipt_lineage_exceptions(company_id,receipt_line_id,exception_code,evidence_key,details)
select unit.company_id,unit.receipt_line_id,'serialized_receipt_mismatch',unit.id::text,
  jsonb_build_object('unitId',unit.id,'unitReceiptId',unit.receipt_id,'lineReceiptId',line.receipt_id)
from inventory_serialized_units unit
join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
where unit.receipt_id<>line.receipt_id
on conflict do nothing;

insert into inventory_receipt_lineage_exceptions(company_id,receipt_line_id,exception_code,evidence_key,details)
select item.company_id,unit.receipt_line_id,'label_receipt_mismatch',item.id::text,
  jsonb_build_object('labelItemId',item.id,'labelReceiptId',batch.receipt_id,'unitReceiptId',unit.receipt_id)
from inventory_label_batch_items item
join inventory_label_batches batch on batch.company_id=item.company_id and batch.id=item.batch_id
join inventory_serialized_units unit on unit.company_id=item.company_id and unit.id=item.unit_id
where batch.receipt_id<>unit.receipt_id
on conflict do nothing;

create index inventory_receipt_lineage_exceptions_queue
  on inventory_receipt_lineage_exceptions(company_id,status,exception_code,created_at,id);

-- The local and generic receipt projections share IDs. These deferred, not-valid
-- constraints protect all new writes without rejecting preserved legacy exceptions.
alter table local_inventory_receipts add constraint local_inventory_receipts_generic_receipt_fk
  foreign key(company_id,id) references inventory_receipts(company_id,id)
  on delete restrict deferrable initially deferred not valid;
alter table local_inventory_receipt_lines add constraint local_inventory_receipt_lines_generic_line_fk
  foreign key(company_id,id) references inventory_receipt_lines(company_id,id)
  on delete restrict deferrable initially deferred not valid;

create unique index inventory_receipt_lines_receipt_identity
  on inventory_receipt_lines(company_id,receipt_id,id);
create unique index inventory_serialized_units_receipt_identity
  on inventory_serialized_units(company_id,receipt_id,id);

alter table inventory_serialized_units add constraint inventory_serialized_units_receipt_line_identity_fk
  foreign key(company_id,receipt_id,receipt_line_id)
  references inventory_receipt_lines(company_id,receipt_id,id)
  on delete restrict not valid;

alter table inventory_label_batch_items add column receipt_id uuid;
update inventory_label_batch_items item set receipt_id=batch.receipt_id
from inventory_label_batches batch
where batch.company_id=item.company_id and batch.id=item.batch_id and item.receipt_id is null;

create unique index inventory_label_batches_receipt_identity
  on inventory_label_batches(company_id,id,receipt_id);

create function inventory_label_item_receipt_guard() returns trigger language plpgsql as $$
declare batch_receipt_id uuid;
declare effective_tracking text;
begin
  select batch.receipt_id into batch_receipt_id
  from inventory_label_batches batch
  where batch.company_id=new.company_id and batch.id=new.batch_id;
  if batch_receipt_id is null then
    raise exception 'Inventory label batch does not exist in this company.' using errcode='23503';
  end if;
  new.receipt_id := coalesce(new.receipt_id,batch_receipt_id);
  if new.receipt_id<>batch_receipt_id then
    raise exception 'Inventory label item receipt does not match its batch.' using errcode='23514';
  end if;
  select coalesce(line.catalog_tracking_mode,part.tracking_mode) into effective_tracking
  from inventory_serialized_units unit
  join inventory_receipt_lines line on line.company_id=unit.company_id and line.id=unit.receipt_line_id
  join parts_catalog part on part.company_id=line.company_id and part.id=line.catalog_part_id
  where unit.company_id=new.company_id and unit.id=new.unit_id and unit.receipt_id=new.receipt_id;
  if effective_tracking is distinct from 'serialized' then
    raise exception 'Labels are only available for serialized receipt units.' using errcode='23514';
  end if;
  return new;
end $$;

create trigger inventory_label_item_receipt_guard
before insert or update of company_id,batch_id,unit_id,receipt_id on inventory_label_batch_items
for each row execute function inventory_label_item_receipt_guard();

alter table inventory_label_batch_items alter column receipt_id set not null;
alter table inventory_label_batch_items add constraint inventory_label_batch_items_batch_receipt_fk
  foreign key(company_id,batch_id,receipt_id)
  references inventory_label_batches(company_id,id,receipt_id)
  on delete restrict not valid;
alter table inventory_label_batch_items add constraint inventory_label_batch_items_unit_receipt_fk
  foreign key(company_id,receipt_id,unit_id)
  references inventory_serialized_units(company_id,receipt_id,id)
  on delete restrict not valid;

-- Multiple physical receipts may post against one invoice. Actor-scoped command
-- idempotency remains the replay boundary; Odoo retains its one-receipt projection.
alter table local_inventory_receipts
  drop constraint if exists local_inventory_receipts_company_id_invoice_run_id_key;
alter table inventory_receipts
  drop constraint if exists inventory_receipts_company_id_invoice_run_id_key;
create index local_inventory_receipts_invoice_history
  on local_inventory_receipts(company_id,invoice_run_id,posted_at,id)
  where invoice_run_id is not null;
create index inventory_receipts_invoice_history
  on inventory_receipts(company_id,invoice_run_id,created_at,id)
  where invoice_run_id is not null;
create unique index inventory_receipts_odoo_invoice_unique
  on inventory_receipts(company_id,invoice_run_id) where provider='odoo' and invoice_run_id is not null;

alter table local_inventory_receipts drop constraint local_inventory_receipts_confirmation_check;
alter table local_inventory_receipts add constraint local_inventory_receipts_confirmation_check check (
  physical_confirmation in ('all_received_undamaged','received_on_hold','physically_received','legacy_post')
);

-- Allocation plans can now post as several immutable receipt-line allocations.
alter table inventory_purchase_invoice_allocations
  drop constraint if exists inventory_purchase_invoice_allocations_company_id_invoice_run_id_invoice_line_index_purchase_line_id_key;
create unique index inventory_purchase_invoice_allocations_planned_unique
  on inventory_purchase_invoice_allocations(company_id,invoice_run_id,invoice_line_index,purchase_line_id)
  where status='planned';
create unique index inventory_purchase_invoice_allocations_posted_receipt_unique
  on inventory_purchase_invoice_allocations(company_id,receipt_line_id)
  where status='posted';

create function protect_posted_purchase_invoice_allocation() returns trigger language plpgsql as $$
begin
  if old.status='posted' then
    raise exception 'Posted purchase invoice allocations are append-only.' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger inventory_purchase_invoice_allocations_append_only
before update or delete on inventory_purchase_invoice_allocations
for each row execute function protect_posted_purchase_invoice_allocation();

-- Purchase status now describes line-level inventory completion.
alter table inventory_purchase_orders drop constraint inventory_purchase_orders_status_check;
alter table inventory_purchase_orders add constraint inventory_purchase_orders_status_check check (
  status in ('draft','awaiting_approval','ordered','partially_received','received','closed_with_discrepancy','cancelled')
);
update inventory_purchase_orders purchase_order
set status=case
  when coalesce(summary.received_quantity,0)=0 then 'ordered'
  when summary.open_quantity=0 then 'received'
  else 'partially_received'
end,
updated_at=now()
from (
  select company_id,order_id,sum(received_quantity) received_quantity,
    sum(quantity-received_quantity-cancelled_quantity) open_quantity
  from inventory_purchase_lines group by company_id,order_id
) summary
where purchase_order.company_id=summary.company_id and purchase_order.id=summary.order_id
  and purchase_order.status in ('ordered','received');

create table inventory_purchase_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  order_id uuid,
  invoice_run_id uuid,
  location_id uuid not null,
  received_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check(char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  status varchar(16) not null default 'posted' check(status in ('posted','void')),
  reference varchar(240) not null default '',
  notes varchar(2000) not null default '',
  received_at timestamptz not null default now(),
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references inventory_purchase_orders(company_id,id) on delete restrict,
  foreign key(company_id,invoice_run_id) references invoice_extraction_runs(company_id,id) on delete restrict,
  foreign key(company_id,location_id) references locations(company_id,id) on delete restrict,
  check(order_id is not null or invoice_run_id is not null),
  check((status='posted' and voided_at is null) or (status='void' and voided_at is not null)),
  unique(company_id,id),
  unique(company_id,received_by,idempotency_key)
);

create table inventory_purchase_delivery_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  delivery_id uuid not null,
  purchase_line_id uuid,
  invoice_line_index integer check(invoice_line_index is null or invoice_line_index>=0),
  receipt_line_id uuid,
  outcome varchar(24) not null check(outcome in ('accepted','damaged','quarantined','rejected','wrong_item','shortage','overage')),
  expected_quantity numeric(14,3) not null default 0 check(expected_quantity>=0),
  actual_quantity numeric(14,3) not null default 0 check(actual_quantity>=0),
  usable_quantity numeric(14,3) not null default 0 check(usable_quantity>=0),
  held_quantity numeric(14,3) not null default 0 check(held_quantity>=0),
  rejected_quantity numeric(14,3) not null default 0 check(rejected_quantity>=0),
  uom_code text not null references units_of_measure(code),
  reason varchar(500) not null default '',
  created_at timestamptz not null default now(),
  foreign key(company_id,delivery_id) references inventory_purchase_deliveries(company_id,id) on delete restrict,
  foreign key(company_id,purchase_line_id) references inventory_purchase_lines(company_id,id) on delete restrict,
  foreign key(company_id,receipt_line_id) references inventory_receipt_lines(company_id,id) on delete restrict,
  check(purchase_line_id is not null or invoice_line_index is not null),
  check(actual_quantity=usable_quantity+held_quantity+rejected_quantity),
  check(
    (outcome='shortage' and receipt_line_id is null and expected_quantity>0 and actual_quantity=0)
    or (outcome<>'shortage' and receipt_line_id is not null and actual_quantity>0)
  ),
  check(outcome<>'accepted' or (usable_quantity=actual_quantity and held_quantity=0 and rejected_quantity=0)),
  check(outcome<>'damaged' or held_quantity+rejected_quantity>0),
  check(outcome<>'quarantined' or held_quantity>0),
  check(outcome<>'rejected' or (rejected_quantity=actual_quantity and usable_quantity=0 and held_quantity=0)),
  check(outcome<>'wrong_item' or (usable_quantity=0 and held_quantity+rejected_quantity=actual_quantity)),
  unique(company_id,id)
);

create unique index inventory_purchase_delivery_lines_receipt_unique
  on inventory_purchase_delivery_lines(company_id,receipt_line_id) where receipt_line_id is not null;
create index inventory_purchase_deliveries_order_history
  on inventory_purchase_deliveries(company_id,order_id,received_at,id) where order_id is not null;
create index inventory_purchase_deliveries_invoice_history
  on inventory_purchase_deliveries(company_id,invoice_run_id,received_at,id) where invoice_run_id is not null;
create index inventory_purchase_delivery_lines_purchase_line
  on inventory_purchase_delivery_lines(company_id,purchase_line_id,created_at,id) where purchase_line_id is not null;
create index inventory_purchase_delivery_lines_invoice_line
  on inventory_purchase_delivery_lines(company_id,delivery_id,invoice_line_index,created_at,id) where invoice_line_index is not null;

create function validate_inventory_purchase_delivery_line() returns trigger language plpgsql as $$
declare delivery_order_id uuid;
declare delivery_invoice_run_id uuid;
declare delivery_location_id uuid;
declare purchase_order_id uuid;
declare receipt_location_id uuid;
begin
  select delivery.order_id,delivery.invoice_run_id,delivery.location_id
    into delivery_order_id,delivery_invoice_run_id,delivery_location_id
  from inventory_purchase_deliveries delivery
  where delivery.company_id=new.company_id and delivery.id=new.delivery_id for key share;
  if new.purchase_line_id is not null then
    select line.order_id into purchase_order_id from inventory_purchase_lines line
    where line.company_id=new.company_id and line.id=new.purchase_line_id for key share;
    if delivery_order_id is null or purchase_order_id is distinct from delivery_order_id then
      raise exception 'Purchase delivery line does not belong to the delivery order.' using errcode='23514';
    end if;
  end if;
  if new.invoice_line_index is not null and delivery_invoice_run_id is null then
    raise exception 'Invoice delivery line requires an invoice source.' using errcode='23514';
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
create trigger inventory_purchase_delivery_line_guard
before insert or update of company_id,delivery_id,purchase_line_id,invoice_line_index,receipt_line_id
on inventory_purchase_delivery_lines
for each row execute function validate_inventory_purchase_delivery_line();

comment on table inventory_purchase_deliveries is
  'Idempotent physical delivery event linked to a purchase order, reviewed invoice, or both; inventory remains represented by receipt-line batches.';
comment on table inventory_purchase_delivery_lines is
  'PO-line or invoice-line accepted, held, rejected, wrong, short and over-receipt evidence linked to the canonical receipt-line batch.';

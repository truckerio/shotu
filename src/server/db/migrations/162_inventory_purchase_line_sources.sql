set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_purchase_line_sources (
  company_id uuid not null,
  purchase_line_id uuid not null,
  source_type text not null check (source_type in ('workorder_request','stocking_policy','legacy_request')),
  source_id uuid not null,
  planned_quantity numeric(14,3) not null check (planned_quantity > 0),
  received_quantity numeric(14,3) not null default 0 check (received_quantity >= 0),
  cancelled_quantity numeric(14,3) not null default 0 check (cancelled_quantity >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id,purchase_line_id,source_type,source_id),
  foreign key (company_id,purchase_line_id)
    references inventory_purchase_lines(company_id,id) on delete restrict,
  check (received_quantity + cancelled_quantity <= planned_quantity)
);

create index inventory_purchase_line_sources_source_idx
  on inventory_purchase_line_sources(company_id,source_type,source_id,purchase_line_id);

create or replace function reconcile_inventory_purchase_line_sources()
returns trigger language plpgsql as $$
declare
  source record;
  received_remaining numeric(14,3) := new.received_quantity;
  cancelled_remaining numeric(14,3) := new.cancelled_quantity;
  source_received numeric(14,3);
  source_cancelled numeric(14,3);
begin
  for source in
    select company_id,purchase_line_id,source_type,source_id,planned_quantity
    from inventory_purchase_line_sources
    where company_id=new.company_id and purchase_line_id=new.id
    order by created_at,source_type,source_id
    for update
  loop
    source_received := least(source.planned_quantity,greatest(received_remaining,0));
    received_remaining := greatest(received_remaining-source_received,0);
    source_cancelled := least(source.planned_quantity-source_received,greatest(cancelled_remaining,0));
    cancelled_remaining := greatest(cancelled_remaining-source_cancelled,0);
    update inventory_purchase_line_sources
      set received_quantity=source_received,
          cancelled_quantity=source_cancelled,
          updated_at=now()
      where company_id=source.company_id and purchase_line_id=source.purchase_line_id
        and source_type=source.source_type and source_id=source.source_id;
  end loop;
  return new;
end $$;

create trigger inventory_purchase_line_sources_reconcile
after update of received_quantity,cancelled_quantity on inventory_purchase_lines
for each row execute function reconcile_inventory_purchase_line_sources();

-- Existing standalone requests stay readable. Approved records become eligible
-- legacy demand only when an operator explicitly links them to a future PO line.
comment on table inventory_purchase_line_sources is
  'Immutable demand lineage for purchase lines. Quantities reconcile as receipts and cancellations update the line.';

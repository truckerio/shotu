set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_receipts drop constraint inventory_receipts_provider_check;
alter table inventory_receipts
  add constraint inventory_receipts_provider_check check (provider in ('odoo', 'local'));

alter table inventory_receipts drop constraint inventory_receipts_confirmed_state;
alter table inventory_receipts
  add constraint inventory_receipts_confirmed_state check (
    status <> 'confirmed'
    or (
      confirmed_at is not null
      and (provider = 'local' or provider_picking_external_id is not null)
    )
  );

alter table inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table inventory_unit_events
  add constraint inventory_unit_events_event_type_check check (
    event_type in ('receipt_staged', 'receipt_confirmed', 'receipt_recorded', 'reconciliation_required', 'void')
  );

insert into inventory_receipts (
  id, company_id, location_id, invoice_run_id, created_by, idempotency_key,
  provider, provider_marker, provider_picking_name, status, confirmed_at,
  created_at, updated_at
)
select receipt.id, receipt.company_id, receipt.location_id, receipt.invoice_run_id,
       receipt.created_by, receipt.idempotency_key, 'local',
       'LOCAL-REC-' || receipt.id::text, 'Local receipt', 'confirmed',
       receipt.posted_at, receipt.created_at, receipt.updated_at
from local_inventory_receipts receipt
where receipt.status = 'posted'
  and not exists (
    select 1 from inventory_receipts existing
    where existing.company_id = receipt.company_id
      and existing.invoice_run_id = receipt.invoice_run_id
  );

with eligible_receipts as (
  select line.company_id, line.receipt_id
  from local_inventory_receipt_lines line
  join units_of_measure uom on uom.code = line.uom_code
  join inventory_receipts receipt
    on receipt.company_id = line.company_id and receipt.id = line.receipt_id
   and receipt.provider = 'local'
  where uom.category in ('count', 'packaging')
    and line.quantity = trunc(line.quantity)
    and line.quantity between 1 and 1000
  group by line.company_id, line.receipt_id
  having sum(line.quantity) <= 500
)
insert into inventory_receipt_lines (
  id, company_id, receipt_id, line_index, catalog_part_id,
  product_external_id, part_number, description, quantity, uom_code, tracking_mode
)
select line.id, line.company_id, line.receipt_id, line.line_index,
       line.catalog_part_id, 'local:' || line.catalog_part_id::text,
       line.part_number, line.description, line.quantity::integer,
       line.uom_code, 'serial'
from local_inventory_receipt_lines line
join eligible_receipts eligible
  on eligible.company_id = line.company_id and eligible.receipt_id = line.receipt_id
join units_of_measure uom on uom.code = line.uom_code
where uom.category in ('count', 'packaging')
  and line.quantity = trunc(line.quantity)
  and line.quantity between 1 and 1000
on conflict (company_id, receipt_id, line_index) do nothing;

insert into inventory_serialized_units (
  company_id, location_id, receipt_id, receipt_line_id,
  unit_ordinal, serial_number, status, created_at, updated_at
)
select receipt.company_id, receipt.location_id, receipt.id, line.id,
       ordinal,
       'WG-L-' || upper(substr(replace(receipt.id::text, '-', ''), 1, 16))
         || '-' || (line.line_index + 1)::text || '-' || ordinal::text,
       'in_stock', receipt.confirmed_at, receipt.confirmed_at
from inventory_receipts receipt
join inventory_receipt_lines line
  on line.company_id = receipt.company_id and line.receipt_id = receipt.id
cross join lateral generate_series(1, line.quantity) ordinal
where receipt.provider = 'local'
on conflict (company_id, receipt_line_id, unit_ordinal) do nothing;

insert into inventory_unit_events (
  company_id, unit_id, event_type, actor_id, details, created_at
)
select unit.company_id, unit.id, 'receipt_recorded', receipt.created_by,
       jsonb_build_object('source', 'local_invoice'), receipt.confirmed_at
from inventory_serialized_units unit
join inventory_receipts receipt
  on receipt.company_id = unit.company_id and receipt.id = unit.receipt_id
where receipt.provider = 'local'
  and not exists (
    select 1 from inventory_unit_events event
    where event.company_id = unit.company_id
      and event.unit_id = unit.id
      and event.event_type = 'receipt_recorded'
  );

comment on column inventory_receipts.provider is
  'Receipt identity source. Local receipts need no external picking confirmation.';
comment on table inventory_serialized_units is
  'Exact physical identities from confirmed Odoo lots or application-owned local receipts.';

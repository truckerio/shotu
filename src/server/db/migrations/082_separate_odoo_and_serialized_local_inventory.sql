set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table odoo_inventory_balances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  normalized_part_number text not null check (btrim(normalized_part_number) <> ''),
  part_number varchar(200) not null check (btrim(part_number) <> ''),
  description varchar(1000) not null default '',
  quantity_on_hand numeric(14, 3) not null check (quantity_on_hand >= 0),
  uom_code text not null references units_of_measure(code),
  external_id text not null check (btrim(external_id) <> ''),
  provider_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint odoo_inventory_balances_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint odoo_inventory_balances_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  unique (company_id, external_id),
  unique (company_id, location_id, catalog_part_id, uom_code),
  unique (company_id, id)
);

insert into odoo_inventory_balances (
  company_id, location_id, catalog_part_id, normalized_part_number,
  part_number, description, quantity_on_hand, uom_code, external_id,
  provider_updated_at, last_seen_at, created_at, updated_at
)
select company_id, location_id, catalog_part_id, normalized_part_number,
       part_number, description, quantity_on_hand, uom_code, external_id,
       provider_updated_at, coalesce(last_seen_at, now()), updated_at, updated_at
from inventory_items
where source_provider = 'odoo' and location_id is not null and catalog_part_id is not null
on conflict (company_id, location_id, catalog_part_id, uom_code) do update
set quantity_on_hand = excluded.quantity_on_hand,
    external_id = excluded.external_id,
    provider_updated_at = excluded.provider_updated_at,
    last_seen_at = excluded.last_seen_at,
    updated_at = excluded.updated_at;

-- Preserve old row IDs for any historical allocation references, but remove
-- them from application inventory identity and availability.
update inventory_items
set normalized_part_number = 'LEGACY-ODOO-' || id::text,
    source_provider = 'odoo_legacy_reference',
    external_id = 'legacy:' || id::text,
    quantity_on_hand = quantity_reserved,
    provider_updated_at = null,
    last_seen_at = null,
    updated_at = now()
where source_provider = 'odoo';

create index odoo_inventory_balances_part_location_idx
  on odoo_inventory_balances (company_id, catalog_part_id, location_id, updated_at desc, id);

create table inventory_serialization_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  quantity integer not null check (quantity between 1 and 500),
  physical_confirmation varchar(48) not null check (physical_confirmation = 'physically_present_at_location'),
  created_at timestamptz not null default now(),
  constraint inventory_serialization_batches_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_serialization_batches_catalog_company_fk
    foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  unique (company_id, created_by, idempotency_key),
  unique (company_id, id)
);

create index inventory_serialization_batches_part_history_idx
  on inventory_serialization_batches (company_id, catalog_part_id, location_id, created_at desc, id);

alter table inventory_receipts
  add column serialization_batch_id uuid;

alter table inventory_receipts drop constraint inventory_receipts_provider_check;
alter table inventory_receipts
  add constraint inventory_receipts_provider_check
    check (provider in ('odoo', 'local', 'local_count', 'local_serialization'));

alter table inventory_receipts drop constraint inventory_receipts_confirmed_state;
alter table inventory_receipts
  add constraint inventory_receipts_confirmed_state check (
    status <> 'confirmed'
    or (
      confirmed_at is not null
      and (provider in ('local', 'local_count', 'local_serialization') or provider_picking_external_id is not null)
    )
  );

alter table inventory_receipts drop constraint inventory_receipts_source_check;
alter table inventory_receipts
  add constraint inventory_receipts_source_check check (
    (provider = 'local_count' and invoice_run_id is null and count_import_id is not null and serialization_batch_id is null)
    or (provider = 'local_serialization' and invoice_run_id is null and count_import_id is null and serialization_batch_id is not null)
    or (provider not in ('local_count', 'local_serialization') and invoice_run_id is not null and count_import_id is null and serialization_batch_id is null)
  ),
  add constraint inventory_receipts_serialization_batch_company_fk
    foreign key (company_id, serialization_batch_id)
    references inventory_serialization_batches(company_id, id) on delete restrict;

alter table inventory_label_batches drop constraint inventory_label_batches_purpose_check;
alter table inventory_label_batches
  add constraint inventory_label_batches_purpose_check
    check (purpose in ('receipt', 'stock_count', 'serialization'));

comment on table odoo_inventory_balances is
  'Read-only Odoo quantity projection. It never represents application-owned or reservable inventory.';
comment on table inventory_serialization_batches is
  'Idempotent physical intake that creates application-owned serialized children and matching QR labels.';
comment on column inventory_receipts.serialization_batch_id is
  'Physical serialized-intake source with no seller invoice or Odoo receipt.';

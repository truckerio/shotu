set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table local_inventory_receipts
  add column reviewed_run_version integer,
  add column physical_confirmation varchar(40),
  add column confirmation_hash char(64);

update local_inventory_receipts receipt
set reviewed_run_version = run.version
from invoice_extraction_runs run
where run.company_id = receipt.company_id
  and run.id = receipt.invoice_run_id
  and receipt.reviewed_run_version is null;

update local_inventory_receipts
set physical_confirmation = coalesce(physical_confirmation, 'legacy_post'),
    confirmation_hash = coalesce(confirmation_hash, request_hash)
where physical_confirmation is null
   or confirmation_hash is null;

alter table local_inventory_receipts
  alter column reviewed_run_version set not null,
  alter column physical_confirmation set not null,
  alter column confirmation_hash set not null,
  add constraint local_inventory_receipts_reviewed_version_check
    check (reviewed_run_version >= 1),
  add constraint local_inventory_receipts_confirmation_check
    check (physical_confirmation in ('all_received_undamaged', 'legacy_post')),
  add constraint local_inventory_receipts_confirmation_hash_check
    check (confirmation_hash ~ '^[0-9a-f]{64}$');

create table inventory_label_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  receipt_id uuid not null,
  created_by uuid not null references user_profiles(id) on delete restrict,
  purpose varchar(24) not null default 'receipt' check (purpose = 'receipt'),
  template_version varchar(40) not null check (btrim(template_version) <> ''),
  status varchar(16) not null default 'ready' check (status in ('ready', 'void')),
  item_count integer not null check (item_count between 1 and 500),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  constraint inventory_label_batches_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_label_batches_receipt_company_fk
    foreign key (company_id, receipt_id) references local_inventory_receipts(company_id, id) on delete restrict,
  constraint inventory_label_batches_void_state check (
    (status = 'void' and voided_at is not null) or
    (status = 'ready' and voided_at is null)
  ),
  unique (company_id, receipt_id),
  unique (company_id, id)
);

create table inventory_label_batch_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  batch_id uuid not null,
  unit_id uuid not null,
  ordinal integer not null check (ordinal between 1 and 500),
  part_number_snapshot varchar(200) not null check (btrim(part_number_snapshot) <> ''),
  description_snapshot varchar(1000) not null default '',
  serial_number_snapshot varchar(100) not null check (btrim(serial_number_snapshot) <> ''),
  location_name_snapshot varchar(300) not null check (btrim(location_name_snapshot) <> ''),
  qr_format_version integer not null default 1 check (qr_format_version = 1),
  created_at timestamptz not null default now(),
  constraint inventory_label_batch_items_batch_company_fk
    foreign key (company_id, batch_id) references inventory_label_batches(company_id, id) on delete restrict,
  constraint inventory_label_batch_items_unit_company_fk
    foreign key (company_id, unit_id) references inventory_serialized_units(company_id, id) on delete restrict,
  unique (company_id, batch_id, ordinal),
  unique (company_id, batch_id, unit_id),
  unique (company_id, id)
);

create index inventory_label_batches_receipt_idx
  on inventory_label_batches (company_id, receipt_id, created_at desc, id);
create index inventory_label_batch_items_page_idx
  on inventory_label_batch_items (company_id, batch_id, ordinal, id);

comment on column local_inventory_receipts.physical_confirmation is
  'Explicit physical receipt attestation. legacy_post marks rows created before this contract.';
comment on table inventory_label_batches is
  'Immutable, reprintable label manifest for one physically confirmed local receipt.';
comment on table inventory_label_batch_items is
  'Label text snapshots and exact unit identity. QR images are regenerated from the durable unit ID.';

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_authority_cutovers
  alter column inventory_item_id drop not null,
  add column source_kind text not null default 'legacy_inventory_item',
  add column odoo_balance_id uuid,
  add column resolution_state text not null default 'superseded';

alter table inventory_authority_cutovers
  add constraint inventory_authority_cutovers_odoo_balance_company_fk
    foreign key (company_id, odoo_balance_id)
    references odoo_inventory_balances(company_id, id) on delete restrict,
  add constraint inventory_authority_cutovers_source_shape check (
    (source_kind = 'legacy_inventory_item' and inventory_item_id is not null and odoo_balance_id is null)
    or
    (source_kind = 'odoo_balance' and inventory_item_id is null and odoo_balance_id is not null)
  ),
  add constraint inventory_authority_cutovers_resolution_state_check
    check (resolution_state = 'superseded');

alter table inventory_authority_cutovers
  drop constraint if exists inventory_authority_cutovers_company_id_receipt_line_id_key;

create unique index inventory_authority_cutovers_legacy_source_uidx
  on inventory_authority_cutovers (company_id, receipt_line_id, inventory_item_id)
  where source_kind = 'legacy_inventory_item';

create unique index inventory_authority_cutovers_odoo_source_uidx
  on inventory_authority_cutovers (company_id, receipt_line_id, odoo_balance_id)
  where source_kind = 'odoo_balance';

create table inventory_authority_exceptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  requested_catalog_part_id uuid not null,
  requested_normalized_part_number text not null,
  requested_uom_code text not null references units_of_measure(code),
  state text not null check (state in ('reservation_blocked', 'unmatched_identity')),
  source_kind text not null check (source_kind in ('legacy_inventory_item', 'odoo_balance')),
  inventory_item_id uuid,
  odoo_balance_id uuid,
  details jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint inventory_authority_exceptions_location_company_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint inventory_authority_exceptions_catalog_company_fk
    foreign key (company_id, requested_catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint inventory_authority_exceptions_item_company_fk
    foreign key (company_id, inventory_item_id) references inventory_items(company_id, id) on delete restrict,
  constraint inventory_authority_exceptions_odoo_company_fk
    foreign key (company_id, odoo_balance_id) references odoo_inventory_balances(company_id, id) on delete restrict,
  constraint inventory_authority_exceptions_source_shape check (
    (source_kind = 'legacy_inventory_item' and inventory_item_id is not null and odoo_balance_id is null)
    or
    (source_kind = 'odoo_balance' and inventory_item_id is null and odoo_balance_id is not null)
  )
);

create unique index inventory_authority_exceptions_open_legacy_uidx
  on inventory_authority_exceptions (company_id, inventory_item_id, state)
  where resolved_at is null and source_kind = 'legacy_inventory_item';

create unique index inventory_authority_exceptions_open_odoo_uidx
  on inventory_authority_exceptions (company_id, odoo_balance_id, state)
  where resolved_at is null and source_kind = 'odoo_balance';

comment on table inventory_authority_exceptions is
  'Admin reconciliation evidence for blocked or identity-ambiguous provider inventory; never usable stock.';

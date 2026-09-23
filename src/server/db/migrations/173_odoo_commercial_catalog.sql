set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Current Odoo commercial facts are provider snapshots. They are intentionally
-- separate from append-only local price decisions and from purchase-order cost
-- history. A missing currency keeps a provider amount informational/Unknown.
alter table odoo_product_mappings
  add column internal_price numeric(18, 4),
  add column internal_currency varchar(3),
  add column selling_price numeric(18, 4),
  add column selling_currency varchar(3),
  add column commercial_updated_at timestamptz,
  add constraint odoo_product_mappings_internal_price_check
    check (internal_price is null or internal_price >= 0),
  add constraint odoo_product_mappings_selling_price_check
    check (selling_price is null or selling_price >= 0),
  add constraint odoo_product_mappings_internal_currency_check
    check (internal_currency is null or internal_currency ~ '^[A-Z]{3}$'),
  add constraint odoo_product_mappings_selling_currency_check
    check (selling_currency is null or selling_currency ~ '^[A-Z]{3}$');

alter table odoo_service_products
  add column internal_price numeric(18, 4),
  add column internal_currency varchar(3),
  add column selling_price numeric(18, 4),
  add column selling_currency varchar(3),
  add column commercial_updated_at timestamptz,
  add constraint odoo_service_products_internal_price_check
    check (internal_price is null or internal_price >= 0),
  add constraint odoo_service_products_selling_price_check
    check (selling_price is null or selling_price >= 0),
  add constraint odoo_service_products_internal_currency_check
    check (internal_currency is null or internal_currency ~ '^[A-Z]{3}$'),
  add constraint odoo_service_products_selling_currency_check
    check (selling_currency is null or selling_currency ~ '^[A-Z]{3}$');

alter table local_labor_products
  add column source_provider text,
  add column source_external_id text,
  add constraint local_labor_products_source_pair_check check (
    (source_provider is null and source_external_id is null)
    or (source_provider = 'odoo' and btrim(source_external_id) <> '')
  ),
  add constraint local_labor_products_odoo_source_fkey
    foreign key (company_id, source_external_id)
    references odoo_service_products(company_id, external_id)
    on delete restrict;

create unique index local_labor_products_odoo_source_uidx
  on local_labor_products(company_id, source_provider, source_external_id)
  where source_provider is not null and source_external_id is not null;

-- Link previously copied labor snapshots only when one local row and one Odoo
-- source match deterministically by normalized code or normalized name.
with candidates as (
  select local.id local_id, local.company_id, source.external_id,
         count(*) over (partition by local.company_id, local.id) local_matches,
         count(*) over (partition by source.company_id, source.external_id) source_matches
  from local_labor_products local
  join odoo_service_products source
    on source.company_id=local.company_id
   and source.active
   and source.product_type='service'
   and source.uom_name ~* '^hours?$'
   and source.uom_category_name ~* 'time'
   and ((local.normalized_code <> '' and local.normalized_code=regexp_replace(lower(source.default_code),'[^a-z0-9]+','','g'))
     or local.normalized_name=regexp_replace(lower(btrim(source.display_name)),'\s+',' ','g'))
)
update local_labor_products local
set source_provider='odoo', source_external_id=candidate.external_id, updated_at=now()
from candidates candidate
where local.company_id=candidate.company_id and local.id=candidate.local_id
  and candidate.local_matches=1 and candidate.source_matches=1
  and local.source_provider is null and local.source_external_id is null;

comment on column odoo_product_mappings.internal_price is
  'Current Odoo standard_price snapshot; local configured prices remain authoritative.';
comment on column odoo_product_mappings.selling_price is
  'Current Odoo lst_price/list_price snapshot; local configured prices remain authoritative.';
comment on column local_labor_products.source_external_id is
  'Stable Odoo service-product identity for copied labor rows; null for application-created labor.';

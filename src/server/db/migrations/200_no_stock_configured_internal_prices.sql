set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_part_price_snapshots
  add column configured_price_version_id uuid,
  add constraint workorder_part_configured_price_fk
    foreign key(company_id,configured_price_version_id)
    references inventory_part_price_versions(company_id,id) on delete restrict,
  drop constraint workorder_part_price_snapshots_selection_check,
  add constraint workorder_part_price_snapshots_selection_check
    check(selection in ('batch_cost','internal_cost','selling_price')),
  drop constraint workorder_part_price_source_shape,
  add constraint workorder_part_price_source_shape check(
    (selection='batch_cost' and selling_policy_version_id is null
      and configured_price_version_id is null and no_stock_line_id is null
      and ((serialized_usage_id is not null and receipt_line_id is not null)
        or aggregate_usage_id is not null))
    or (selection='selling_price' and selling_policy_version_id is not null
      and configured_price_version_id is null)
    or (selection='internal_cost' and no_stock_line_id is not null
      and configured_price_version_id is not null
      and selling_policy_version_id is null and receipt_line_id is null)
  );

alter table workorder_labor_price_snapshots
  add column configured_price_version_id uuid,
  add constraint labor_price_configured_price_fk
    foreign key(company_id,configured_price_version_id)
    references inventory_part_price_versions(company_id,id) on delete restrict,
  drop constraint labor_price_exactly_one_source,
  add constraint labor_price_exactly_one_source check (
    (rate_version_id is not null and selling_policy_version_id is null and configured_price_version_id is null)
    or (rate_version_id is null and selling_policy_version_id is not null
      and configured_price_version_id is null and selection='selling_price')
    or (rate_version_id is null and selling_policy_version_id is null
      and configured_price_version_id is not null and selection='internal_cost')
  );

comment on column workorder_part_price_snapshots.configured_price_version_id is
  'Immutable configured internal price version for a no-stock catalog charge; never a receipt batch cost.';
comment on column workorder_labor_price_snapshots.configured_price_version_id is
  'Immutable internal price version from a uniquely matching no-stock catalog service when no explicit labor rate exists.';

create function enforce_no_stock_configured_price_source() returns trigger as $$
begin
  if new.configured_price_version_id is null then return new; end if;
  if not exists (
    select 1 from inventory_part_price_versions price
    join operational_workorders workorder
      on workorder.company_id=new.company_id and workorder.id=new.workorder_id
    where price.company_id=new.company_id and price.id=new.configured_price_version_id
      and price.catalog_part_id=new.catalog_part_id and price.price_kind='internal'
      and price.amount=coalesce(new.base_unit_price,new.unit_price)
      and price.currency=new.currency
      and (price.location_id is null or price.location_id=workorder.location_id)
  ) then
    raise exception 'No-stock configured internal price source does not match its snapshot.'
      using errcode='23514',constraint='workorder_part_configured_price_source';
  end if;
  return new;
end $$ language plpgsql;

create trigger workorder_part_configured_price_source
  before insert on workorder_part_price_snapshots
  for each row execute function enforce_no_stock_configured_price_source();

create function enforce_labor_configured_price_source() returns trigger as $$
begin
  if new.configured_price_version_id is null then return new; end if;
  if not exists (
    select 1 from inventory_part_price_versions price
    join parts_catalog catalog on catalog.company_id=price.company_id
      and catalog.id=price.catalog_part_id and catalog.tracking_mode='no_stock'
    join local_labor_products product on product.company_id=catalog.company_id
      and product.id=new.labor_product_id and product.active=true
      and lower(btrim(product.code))=lower(btrim(catalog.part_number))
      and product.uom_code=catalog.uom_code
    join operational_workorders workorder
      on workorder.company_id=new.company_id and workorder.id=new.workorder_id
    where price.company_id=new.company_id and price.id=new.configured_price_version_id
      and price.price_kind='internal'
      and price.amount=coalesce(new.base_unit_price,new.unit_price)
      and price.currency=new.currency
      and (price.location_id is null or price.location_id=workorder.location_id)
      and (select count(*) from parts_catalog candidate
        where candidate.company_id=product.company_id
          and lower(btrim(candidate.part_number))=lower(btrim(product.code))
          and candidate.uom_code=product.uom_code)=1
      and (select count(*) from local_labor_products candidate
        where candidate.company_id=product.company_id and candidate.active=true
          and lower(btrim(candidate.code))=lower(btrim(product.code))
          and candidate.uom_code=product.uom_code)=1
  ) then
    raise exception 'Labor configured internal price source does not match its snapshot.'
      using errcode='23514',constraint='labor_configured_price_source';
  end if;
  return new;
end $$ language plpgsql;

create trigger labor_configured_price_source
  before insert on workorder_labor_price_snapshots
  for each row execute function enforce_labor_configured_price_source();

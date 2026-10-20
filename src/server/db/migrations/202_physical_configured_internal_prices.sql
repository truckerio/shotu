set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_part_price_snapshots
  drop constraint workorder_part_price_source_shape,
  add constraint workorder_part_price_source_shape check(
    (selection='batch_cost' and selling_policy_version_id is null
      and configured_price_version_id is null and no_stock_line_id is null
      and ((serialized_usage_id is not null and receipt_line_id is not null)
        or aggregate_usage_id is not null))
    or (selection='selling_price' and selling_policy_version_id is not null
      and configured_price_version_id is null)
    or (selection='internal_cost' and configured_price_version_id is not null
      and selling_policy_version_id is null and receipt_line_id is null)
  );

create or replace function enforce_no_stock_configured_price_source() returns trigger as $$
declare
  source_catalog_part_id uuid;
  source_location_id uuid;
begin
  if new.configured_price_version_id is null then return new; end if;

  select coalesce(new.catalog_part_id,serialized.catalog_part_id,aggregate.catalog_part_id),
         workorder.location_id
    into source_catalog_part_id,source_location_id
    from operational_workorders workorder
    left join workorder_serialized_part_usages serialized
      on serialized.company_id=new.company_id and serialized.id=new.serialized_usage_id
    left join workorder_aggregate_part_usages aggregate
      on aggregate.company_id=new.company_id and aggregate.id=new.aggregate_usage_id
   where workorder.company_id=new.company_id and workorder.id=new.workorder_id;

  if not exists (
    select 1 from inventory_part_price_versions price
    where price.company_id=new.company_id and price.id=new.configured_price_version_id
      and price.catalog_part_id=source_catalog_part_id and price.price_kind='internal'
      and price.amount=coalesce(new.base_unit_price,new.unit_price)
      and price.currency=new.currency
      and (price.location_id is null or price.location_id=source_location_id)
  ) then
    raise exception 'Configured internal price source does not match its Workorder snapshot.'
      using errcode='23514',constraint='workorder_part_configured_price_source';
  end if;
  return new;
end $$ language plpgsql;

comment on column workorder_part_price_snapshots.configured_price_version_id is
  'Immutable configured internal price version. Physical usage identity remains on the exact serialized or aggregate usage; receipt and cost-layer lineage remain separate and immutable.';

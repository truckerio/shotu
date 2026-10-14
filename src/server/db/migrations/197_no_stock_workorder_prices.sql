set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_part_price_snapshots
  add column no_stock_line_id uuid,
  add column catalog_part_id uuid,
  add column uom_code text,
  add constraint workorder_part_price_catalog_fk
    foreign key(company_id,catalog_part_id) references parts_catalog(company_id,id) on delete restrict,
  add constraint workorder_part_price_uom_fk
    foreign key(uom_code) references units_of_measure(code) on delete restrict;

alter table workorder_part_price_snapshots
  drop constraint workorder_part_price_usage_shape,
  drop constraint workorder_part_price_source_shape,
  add constraint workorder_part_price_usage_shape check(
    (serialized_usage_id is not null and aggregate_usage_id is null
      and no_stock_line_id is null and catalog_part_id is null and uom_code is null)
    or (serialized_usage_id is null and aggregate_usage_id is not null
      and no_stock_line_id is null and catalog_part_id is null and uom_code is null)
    or (serialized_usage_id is null and aggregate_usage_id is null
      and no_stock_line_id is not null and catalog_part_id is not null and uom_code is not null)
  ),
  add constraint workorder_part_price_source_shape check(
    (selection='batch_cost' and selling_policy_version_id is null
      and no_stock_line_id is null
      and ((serialized_usage_id is not null and receipt_line_id is not null)
        or aggregate_usage_id is not null))
    or (selection='selling_price' and selling_policy_version_id is not null)
  );

create index workorder_part_price_no_stock_history
  on workorder_part_price_snapshots(company_id,workorder_id,no_stock_line_id,created_at desc,id desc)
  where no_stock_line_id is not null;

comment on column workorder_part_price_snapshots.no_stock_line_id is
  'Stable Workorder form-line identity for a no-stock catalog charge. It never references inventory usage.';
comment on column workorder_part_price_snapshots.catalog_part_id is
  'Catalog identity for a no-stock Workorder charge; physical snapshots derive identity from their usage row.';
comment on column workorder_part_price_snapshots.uom_code is
  'Immutable billed unit for a no-stock Workorder charge.';

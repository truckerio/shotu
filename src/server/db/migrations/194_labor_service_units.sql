set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table local_labor_products
  drop constraint local_labor_products_uom_code_check,
  add constraint local_labor_products_uom_code_check check (uom_code in ('hr', 'ea'));

-- Keep the legacy hours column/API name while recording the unit represented
-- by each immutable snapshot. Existing hourly snapshots retain their meaning.
alter table workorder_labor_price_snapshots
  add column uom_code text not null default 'hr',
  add constraint workorder_labor_price_uom_check check (uom_code in ('hr', 'ea')),
  add constraint workorder_labor_price_each_quantity_check check (uom_code <> 'ea' or hours = trunc(hours));

comment on column workorder_labor_price_snapshots.hours is
  'Legacy quantity field: hours for hr labor; whole service count for ea labor.';
comment on table labor_rate_versions is
  'Append-only locally configured per-unit internal and selling rates. A current Unknown location rate masks the company default; Odoo references never overwrite these rates.';

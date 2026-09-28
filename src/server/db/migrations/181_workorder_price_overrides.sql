set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_part_price_snapshots
  add column base_unit_price numeric(14,4),
  add column manual_override boolean not null default false,
  add constraint workorder_part_price_override_shape check (
    (manual_override=false and base_unit_price is null)
    or (manual_override=true and base_unit_price is not null and base_unit_price >= 0)
  );

alter table workorder_labor_price_snapshots
  add column base_unit_price numeric(14,4),
  add column manual_override boolean not null default false,
  add constraint workorder_labor_price_override_shape check (
    (manual_override=false and base_unit_price is null)
    or (manual_override=true and base_unit_price is not null and base_unit_price >= 0)
  );

comment on column workorder_part_price_snapshots.base_unit_price is
  'Selected batch-cost or selling-policy unit price before a Workorder-only manual override.';
comment on column workorder_part_price_snapshots.manual_override is
  'True only when unit_price was manually changed for this Workorder snapshot.';
comment on column workorder_labor_price_snapshots.base_unit_price is
  'Selected internal-cost or selling-price hourly rate before a Workorder-only manual override.';
comment on column workorder_labor_price_snapshots.manual_override is
  'True only when unit_price was manually changed for this Workorder snapshot.';

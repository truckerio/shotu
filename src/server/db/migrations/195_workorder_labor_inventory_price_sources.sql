set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_labor_price_snapshots
  alter column rate_version_id drop not null,
  add column selling_policy_version_id uuid,
  add constraint labor_price_selling_policy_fk foreign key (company_id,selling_policy_version_id)
    references inventory_part_selling_policy_versions(company_id,id) on delete restrict,
  add constraint labor_price_exactly_one_source check (
    (rate_version_id is not null and selling_policy_version_id is null)
    or (rate_version_id is null and selling_policy_version_id is not null and selection='selling_price')
  );

comment on column workorder_labor_price_snapshots.selling_policy_version_id is
  'Immutable source version of a matching local Inventory fixed selling policy; explicit labor rate versions retain precedence.';

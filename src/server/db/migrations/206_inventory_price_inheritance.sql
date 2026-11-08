set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_part_price_versions
  add column uses_company_default boolean not null default false,
  add constraint inventory_part_price_inheritance_shape check (
    not uses_company_default or (location_id is not null and amount is null and currency is null
      and tax_treatment = 'not_configured' and tax_profile_version_id is null)
  );

alter table inventory_part_selling_policy_versions
  add column uses_company_default boolean not null default false,
  alter column method drop not null,
  alter column value drop not null,
  drop constraint inventory_part_selling_policy_versions_method_check,
  drop constraint inventory_part_selling_policy_versions_value_check,
  drop constraint inventory_selling_policy_currency_shape,
  add constraint inventory_selling_policy_inheritance_shape check (
    (uses_company_default and location_id is not null and method is null and value is null and currency is null)
    or (not uses_company_default and method is not null and method in ('fixed','markup_percent','markup_amount') and value is not null and value >= 0
      and ((method='markup_percent' and currency is null)
        or (method in ('fixed','markup_amount') and currency is not null and currency ~ '^[A-Z]{3}$')))
  );

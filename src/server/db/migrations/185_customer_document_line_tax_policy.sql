set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table customer_document_profile_versions
  add column line_tax_policy jsonb not null default '{
    "labor":"not_configured",
    "part":"not_configured",
    "shop_supply":"not_configured",
    "fee":"not_configured",
    "core_charge":"not_configured",
    "credit":"out_of_scope"
  }'::jsonb;

alter table customer_document_profile_versions
  alter column line_tax_policy drop default,
  add constraint customer_document_profile_line_tax_policy_shape check (
    jsonb_typeof(line_tax_policy) = 'object'
    and line_tax_policy ?& array['labor','part','shop_supply','fee','core_charge','credit']
    and line_tax_policy->>'labor' in ('not_configured','exclusive','inclusive','zero_rated','exempt','out_of_scope')
    and line_tax_policy->>'part' in ('not_configured','exclusive','inclusive','zero_rated','exempt','out_of_scope')
    and line_tax_policy->>'shop_supply' in ('not_configured','exclusive','inclusive','zero_rated','exempt','out_of_scope')
    and line_tax_policy->>'fee' in ('not_configured','exclusive','inclusive','zero_rated','exempt','out_of_scope')
    and line_tax_policy->>'core_charge' in ('not_configured','exclusive','inclusive','zero_rated','exempt','out_of_scope')
    and line_tax_policy->>'credit' in ('not_configured','zero_rated','exempt','out_of_scope')
  );

comment on column customer_document_profile_versions.line_tax_policy is
  'Published customer-document tax treatment by canonical line category. Tax components remain owned by inventory_tax_profile_versions.';

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table customer_document_profile_versions alter column tax_profile_version_id drop not null;
alter table customer_document_profile_versions
  add column informational_only boolean not null default false,
  add constraint customer_document_profile_tax_mode_check
    check ((informational_only and tax_profile_version_id is null)
      or (not informational_only and tax_profile_version_id is not null));

comment on column customer_document_profile_versions.informational_only is
  'Server-created scope-only profile for Office direct Workorder creation. It cannot authorize priced Estimates.';

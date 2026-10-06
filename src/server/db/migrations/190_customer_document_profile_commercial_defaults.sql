set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table customer_document_profile_versions
  add column estimate_number_prefix varchar(20) not null default 'EST-' check (char_length(btrim(estimate_number_prefix)) between 1 and 20),
  add column estimate_number_digits smallint not null default 6 check (estimate_number_digits between 4 and 12),
  add column invoice_number_prefix varchar(20) not null default 'INV-' check (char_length(btrim(invoice_number_prefix)) between 1 and 20),
  add column invoice_number_digits smallint not null default 6 check (invoice_number_digits between 4 and 12),
  add column estimate_validity_days smallint check (estimate_validity_days between 1 and 365);

comment on column customer_document_profile_versions.estimate_number_prefix is
  'Immutable published Estimate numbering policy for future documents.';
comment on column customer_document_profile_versions.invoice_number_prefix is
  'Immutable published Invoice numbering policy for future documents.';
comment on column customer_document_profile_versions.estimate_validity_days is
  'Optional immutable default validity period applied server-side to issued Estimates.';

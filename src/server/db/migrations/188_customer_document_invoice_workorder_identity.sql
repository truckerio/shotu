set local lock_timeout = '5s';
set local statement_timeout = '60s';

create unique index customer_documents_invoice_workorder_uidx
  on customer_documents(company_id,workorder_id)
  where document_type='invoice';

comment on index customer_documents_invoice_workorder_uidx is
  'One permanent Invoice identity per Workorder; retries use idempotency and any future correction must be an immutable revision.';

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_purchase_bill_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  order_id uuid not null,
  uploaded_by uuid not null references user_profiles(id),
  idempotency_key uuid not null,
  request_hash char(64) not null,
  file_name text not null,
  mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg','image/webp')),
  byte_size integer not null check (byte_size > 0 and byte_size <= 10485760),
  content_sha256 char(64) not null,
  reference text not null default '',
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_version text not null,
  created_at timestamptz not null default now(),
  foreign key(company_id,order_id) references inventory_purchase_orders(company_id,id),
  unique(company_id,uploaded_by,idempotency_key),
  unique(company_id,order_id,content_sha256)
);
create index inventory_purchase_bill_documents_order on inventory_purchase_bill_documents(company_id,order_id,created_at);

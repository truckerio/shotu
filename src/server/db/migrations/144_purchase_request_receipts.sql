alter table inventory_purchase_requests add column receipt_id uuid;
alter table inventory_purchase_requests add constraint purchase_request_receipt_fkey
  foreign key(company_id,receipt_id) references local_inventory_receipts(company_id,id);
create unique index purchase_request_receipt_unique on inventory_purchase_requests(company_id,receipt_id) where receipt_id is not null;

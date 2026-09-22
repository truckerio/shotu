set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_purchase_orders
  add column delivery_confirmed_at timestamptz,
  add column delivery_confirmed_by uuid references user_profiles(id);

comment on column inventory_purchase_orders.delivery_confirmed_at is
  'Physical delivery confirmation only. Inventory is posted separately through purchase-line receipts.';
comment on column inventory_purchase_lines.received_quantity is
  'Quantity posted to inventory through canonical receipts; delivery confirmation alone does not change it.';

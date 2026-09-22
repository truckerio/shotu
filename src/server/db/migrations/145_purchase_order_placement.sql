set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_purchase_orders drop constraint inventory_purchase_orders_status_check;
alter table inventory_purchase_orders add constraint inventory_purchase_orders_status_check
  check(status in ('draft','pending_approval','approved','ordered','partially_received','received','cancelled'));
alter table inventory_purchase_orders add column placed_at timestamptz;
alter table inventory_purchase_orders add column placed_by uuid references user_profiles(id);

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_purchase_orders
  add column delivery_condition text check (delivery_condition in ('undamaged', 'damaged')),
  add column delivery_damage_details text not null default '',
  add constraint purchase_delivery_damage_details_required check (
    delivery_condition is distinct from 'damaged' or length(trim(delivery_damage_details)) > 0
  );

comment on column inventory_purchase_orders.delivery_condition is
  'Condition reported at delivery. Null means not recorded. Inventory disposition is recorded separately when stock is added.';

alter table inventory_purchase_lines alter column catalog_part_id drop not null;
alter table inventory_purchase_lines add column tracking_mode text check(tracking_mode in ('quantity','serialized','measured_bulk'));

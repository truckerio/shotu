set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table local_inventory_receipts
  drop constraint if exists local_inventory_receipts_line_count_check,
  drop constraint if exists local_inventory_receipts_total_quantity_check;

alter table local_inventory_receipts
  add constraint local_inventory_receipts_line_count_check check(line_count between 0 and 500),
  add constraint local_inventory_receipts_total_quantity_check check(total_quantity>=0);

comment on constraint local_inventory_receipts_line_count_check on local_inventory_receipts is
  'Zero physical lines are allowed when the receipt records durable shortage evidence only.';

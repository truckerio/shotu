set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_stock_movements
  drop constraint inventory_stock_movements_receipt_company_fk,
  drop constraint inventory_stock_movements_line_company_fk;

alter table inventory_stock_movements
  add constraint inventory_stock_movements_receipt_company_fk
    foreign key (company_id, receipt_id) references inventory_receipts(company_id, id) on delete restrict,
  add constraint inventory_stock_movements_line_company_fk
    foreign key (company_id, receipt_line_id) references inventory_receipt_lines(company_id, id) on delete restrict;

comment on column inventory_stock_movements.receipt_id is
  'Optional generic receipt source, including invoice receipts and physically confirmed opening counts.';

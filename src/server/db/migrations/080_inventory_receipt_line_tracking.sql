set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_receipt_lines
  drop constraint inventory_receipt_lines_tracking_mode_check,
  add constraint inventory_receipt_lines_tracking_mode_check
    check (tracking_mode in ('serial', 'aggregate'));

comment on column inventory_receipt_lines.tracking_mode is
  'Canonical receipt-line identity: serial has exact child units; aggregate has quantity only.';

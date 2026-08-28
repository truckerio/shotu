set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_authority_cutovers
  drop constraint inventory_authority_cutovers_receipt_company_fk,
  drop constraint inventory_authority_cutovers_line_company_fk;

alter table inventory_authority_cutovers
  add constraint inventory_authority_cutovers_receipt_company_fk
    foreign key (company_id, receipt_id)
    references inventory_receipts(company_id, id) on delete restrict,
  add constraint inventory_authority_cutovers_line_company_fk
    foreign key (company_id, receipt_line_id)
    references inventory_receipt_lines(company_id, id) on delete restrict;

comment on table inventory_authority_cutovers is
  'Immutable snapshot of an unreserved provider projection replaced by a physically confirmed receipt or opening count.';

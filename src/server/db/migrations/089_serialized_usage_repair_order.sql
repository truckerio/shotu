set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_serialized_part_usages
  add column repair_order text not null default '',
  add constraint workorder_serialized_part_usages_repair_order_length
    check (char_length(repair_order) <= 2000);

-- A serialized usage is a historical inventory record.  Preserve the receipt-line
-- wording instead of reading the mutable catalog at print/detail time.
update workorder_serialized_part_usages usage
   set repair_order = left(btrim(coalesce(line.description, '')), 2000)
  from inventory_serialized_units unit
  join inventory_receipt_lines line
    on line.company_id = unit.company_id
   and line.id = unit.receipt_line_id
 where unit.company_id = usage.company_id
   and unit.id = usage.unit_id
   and btrim(usage.repair_order) = '';

comment on column workorder_serialized_part_usages.repair_order is
  'Work performed wording for this exact serialized usage. Initialized from the receipt-line description and independently editable without changing inventory identity or quantities.';

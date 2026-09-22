set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_count_import_lines
  drop constraint inventory_count_import_lines_quantity_check,
  alter column quantity type numeric(18,3) using quantity::numeric(18,3),
  add column target_position_id uuid;

update inventory_count_import_lines line
set target_position_id = position.id
from inventory_count_imports stocktake
join inventory_positions position
  on position.company_id = stocktake.company_id
 and position.location_id = stocktake.location_id
 and position.system_key = 'unassigned'
where line.company_id = stocktake.company_id
  and line.import_id = stocktake.id
  and line.match_status in ('ready','applied')
  and line.target_position_id is null;

alter table inventory_count_import_lines
  drop constraint inventory_count_import_lines_match_state,
  drop constraint inventory_count_import_lines_match_status_check;

alter table inventory_count_import_lines
  add constraint inventory_count_import_lines_match_status_check check (
    match_status in ('ready','unmatched','duplicate','invalid_quantity','position_required','ignored','applied')
  ),
  add constraint inventory_count_import_lines_match_state check (
    (match_status in ('ready','applied') and catalog_part_id is not null and quantity is not null and target_position_id is not null)
    or (match_status not in ('ready','applied'))
  ),
  add constraint inventory_count_import_lines_quantity_check check (
    quantity is null or (quantity > 0 and quantity <= 500 and quantity = round(quantity,3))
  ),
  add constraint inventory_count_import_lines_target_position_fk
    foreign key(company_id,target_position_id) references inventory_positions(company_id,id) on delete restrict;

create index inventory_count_import_lines_target_position_idx
  on inventory_count_import_lines(company_id,target_position_id)
  where target_position_id is not null;

comment on column inventory_count_import_lines.target_position_id is
  'Reviewed exact storage destination. Legacy ready and applied rows are backfilled to their shop system Unassigned position.';

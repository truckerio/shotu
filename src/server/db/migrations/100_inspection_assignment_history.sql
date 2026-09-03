set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Assignment events are the immutable history. Keep one mutable current row per
-- mechanic so a released mechanic can be assigned again without losing audit data.
alter table inspection_assignments
  drop constraint if exists inspection_assignments_company_id_inspection_id_mechanic_user_id_active_key;

alter table inspection_assignments
  add constraint inspection_assignments_one_row_per_mechanic
  unique (company_id, inspection_id, mechanic_user_id);

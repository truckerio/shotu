set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A corrected inspection is a successor record, so its revised artifact points
-- to an archive owned by the predecessor inspection rather than itself.
alter table inspection_print_archives
  drop constraint if exists inspection_print_predecessor_fk;

alter table inspection_print_archives
  add constraint inspection_print_company_id_id_key unique (company_id, id);

alter table inspection_print_archives
  add constraint inspection_print_predecessor_fk
  foreign key (company_id, predecessor_archive_id)
  references inspection_print_archives(company_id, id) on delete restrict;

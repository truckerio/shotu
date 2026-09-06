alter table inventory_reuse_repairs drop constraint if exists inventory_reuse_repairs_company_id_case_id_key;
create unique index if not exists inventory_reuse_repairs_one_active_case_idx on inventory_reuse_repairs(company_id,case_id) where completed_at is null;
drop index if exists inventory_reuse_one_open_case;
create unique index inventory_reuse_one_open_case on inventory_reuse_cases(company_id,unit_id) where status not in ('released','core_returned','scrapped');

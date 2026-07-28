-- PostgreSQL preserves explicit NOT NULL constraint names when their columns
-- are renamed. Keep the final catalog vocabulary aligned with the runtime
-- contract so production and fresh databases expose the same schema.

create or replace function rename_constraint_if_present(
  table_name text,
  old_constraint_name text,
  new_constraint_name text
) returns void
language plpgsql
as $$
declare
  table_oid regclass;
begin
  table_oid := to_regclass(table_name);
  if table_oid is null then
    return;
  end if;

  if exists (
      select 1
      from pg_constraint
      where conrelid = table_oid
        and conname = old_constraint_name
    )
    and not exists (
      select 1
      from pg_constraint
      where conrelid = table_oid
        and conname = new_constraint_name
    )
  then
    execute format(
      'alter table %s rename constraint %I to %I',
      table_oid,
      old_constraint_name,
      new_constraint_name
    );
  end if;
end;
$$;

select rename_constraint_if_present('assets', 'assets_company_uuid_not_null', 'assets_company_id_not_null');
select rename_constraint_if_present('integration_accounts', 'integration_accounts_company_uuid_not_null', 'integration_accounts_company_id_not_null');
select rename_constraint_if_present('integration_sync_runs', 'integration_sync_runs_company_uuid_not_null', 'integration_sync_runs_company_id_not_null');
select rename_constraint_if_present('inventory_items', 'inventory_items_company_uuid_not_null', 'inventory_items_company_id_not_null');
select rename_constraint_if_present('locations', 'locations_company_uuid_not_null', 'locations_company_id_not_null');
select rename_constraint_if_present('operational_workorders', 'operational_workorders_company_uuid_not_null', 'operational_workorders_company_id_not_null');
select rename_constraint_if_present('parts_catalog', 'parts_catalog_company_uuid_not_null', 'parts_catalog_company_id_not_null');
select rename_constraint_if_present('user_company_memberships', 'user_company_memberships_company_uuid_not_null', 'user_company_memberships_company_id_not_null');
select rename_constraint_if_present('user_invitations', 'user_invitations_company_uuid_not_null', 'user_invitations_company_id_not_null');
select rename_constraint_if_present('user_location_memberships', 'user_location_memberships_company_uuid_not_null', 'user_location_memberships_company_id_not_null');
select rename_constraint_if_present('workorder_serial_counters', 'workorder_serial_counters_company_uuid_not_null', 'workorder_serial_counters_company_id_not_null');

select rename_constraint_if_present('user_profiles', 'app_users_active_not_null', 'user_profiles_active_not_null');
select rename_constraint_if_present('user_profiles', 'app_users_created_at_not_null', 'user_profiles_created_at_not_null');
select rename_constraint_if_present('user_profiles', 'app_users_id_not_null', 'user_profiles_id_not_null');
select rename_constraint_if_present('user_profiles', 'app_users_name_not_null', 'user_profiles_display_name_not_null');
select rename_constraint_if_present('user_profiles', 'app_users_updated_at_not_null', 'user_profiles_updated_at_not_null');

drop function rename_constraint_if_present(text, text, text);

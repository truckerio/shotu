import { readdir } from "node:fs/promises";
import { closePool, getPool } from "../src/server/db/pool.js";

const migrationDirectory = new URL("../src/server/db/migrations/", import.meta.url);

async function checkDatabase() {
  const migrationFiles = (await readdir(migrationDirectory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  const pool = getPool();
  const result = await pool.query(`
    select
      current_setting('server_version') as postgres_version,
      (select count(*)::int from schema_migrations) as applied_migrations,
      (select count(*)::int from pg_views where schemaname = 'public' and viewname like 'v_%') as support_views,
      (select count(*)::int from companies) as companies,
      (select count(*)::int from locations) as locations,
      (select count(*)::int from user_profiles) as users,
      (select count(*)::int from assets) as assets,
      (select count(*)::int from operational_workorders) as workorders,
      (select count(*)::int from v_workorder_operations) as operations_view,
      (select count(*)::int from units_of_measure where active) as active_units_of_measure,
      (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public'
          and (
            (table_name = 'inventory_items' and column_name in ('quantity_on_hand', 'quantity_reserved'))
            or (table_name = 'workorder_part_requests' and column_name = 'quantity')
            or (table_name = 'part_allocations' and column_name = 'quantity')
          )
          and data_type = 'numeric'
          and numeric_scale = 3
      ) as decimal_quantity_columns,
      (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public'
          and table_name = 'v_inventory_availability'
          and column_name = 'uom_code'
      ) as inventory_view_unit_columns,
      (
        select count(distinct trigger_name)::int
        from information_schema.triggers
        where trigger_schema = 'public'
          and trigger_name in (
            'workorder_part_requests_quantity_uom_scale_trigger',
            'part_allocations_quantity_uom_scale_trigger',
            'inventory_items_quantity_uom_scale_trigger'
          )
      ) as quantity_scale_triggers,
      (
        (select count(*)
         from workorder_part_requests request
         join units_of_measure unit on unit.code = request.uom_code
         where unit.decimal_scale = 0 and request.quantity <> trunc(request.quantity))
        + (select count(*)
           from part_allocations allocation
           join units_of_measure unit on unit.code = allocation.uom_code
           where unit.decimal_scale = 0 and allocation.quantity <> trunc(allocation.quantity))
        + (select count(*)
           from inventory_items inventory
           join units_of_measure unit on unit.code = inventory.uom_code
           where unit.decimal_scale = 0
             and (
               inventory.quantity_on_hand <> trunc(inventory.quantity_on_hand)
               or inventory.quantity_reserved <> trunc(inventory.quantity_reserved)
             ))
      )::int as invalid_quantity_scales,
      (
        (select count(*) from parts_catalog where uom_code is null)
        + (select count(*) from inventory_items where uom_code is null)
        + (select count(*) from workorder_part_requests where uom_code is null)
        + (select count(*) from part_allocations where uom_code is null)
      )::int as quantity_rows_without_unit,
      (select count(*)::int from operational_workorders where company_id is null) as workorders_without_company,
      (select count(*)::int from assets where company_id is null) as assets_without_company,
      (select count(*)::int from operational_workorders where location_id is null) as workorders_without_location,
      (
        select count(*)::int
        from user_profiles profile
        where profile.active
          and profile.deleted_at is null
          and not exists (
            select 1
            from user_company_memberships membership
            where membership.user_id = profile.id and membership.active
          )
      ) as active_profiles_without_company,
      (
        select count(*)::int
        from information_schema.columns
        where table_schema = 'public'
          and (
            column_name = 'company_uuid'
            or (table_name = 'operational_workorders' and column_name = 'current_mechanic_id')
            or (table_name = 'user_profiles' and column_name in ('role', 'location_id'))
          )
      ) as legacy_contract_columns,
      (
        select count(*)::int
        from pg_indexes
        where schemaname = 'public'
          and (
            indexname = 'integration_accounts_provider_key'
            or indexname = 'assets_provider_uid_idx'
          )
      ) as global_tenant_indexes,
      (
        select count(*)::int
        from (
          select conname as object_name
          from pg_constraint
          where connamespace = 'public'::regnamespace
          union all
          select indexname
          from pg_indexes
          where schemaname = 'public'
        ) names
        where object_name like '%company_uuid%'
           or object_name like '%app_users%'
      ) as legacy_contract_names
  `);
  const report = {
    nodeVersion: process.version,
    expectedMigrations: migrationFiles.length,
    ...result.rows[0],
  };
  const failures = [];
  if (report.applied_migrations !== report.expectedMigrations) failures.push("migration count does not match the repository");
  if (report.workorders !== report.operations_view) failures.push("operations view does not cover every workorder");
  if (report.active_units_of_measure < 30) failures.push("canonical units of measure are missing");
  if (report.decimal_quantity_columns !== 4) failures.push("part and inventory quantity columns are not numeric(14,3)");
  if (report.inventory_view_unit_columns !== 1) failures.push("inventory availability view does not expose its unit");
  if (report.quantity_scale_triggers !== 3) failures.push("database quantity scale enforcement is missing");
  if (report.invalid_quantity_scales) failures.push("count or packaging rows contain fractional quantities");
  if (report.quantity_rows_without_unit) failures.push("part or inventory quantities are missing a unit");
  if (report.workorders_without_company) failures.push("workorders are missing company ownership");
  if (report.assets_without_company) failures.push("assets are missing company ownership");
  if (report.workorders_without_location) failures.push("workorders are missing a location");
  if (report.active_profiles_without_company) failures.push("active user profiles are missing company membership");
  if (report.legacy_contract_columns) failures.push("legacy database contract columns remain");
  if (report.global_tenant_indexes) failures.push("global integration or asset uniqueness remains");
  if (report.legacy_contract_names) failures.push("legacy constraint or index names remain");

  console.log(JSON.stringify({ healthy: failures.length === 0, ...report, failures }));
  if (failures.length) process.exitCode = 1;
}

checkDatabase()
  .catch((error) => {
    console.error(JSON.stringify({ healthy: false, error: error.message }));
    process.exitCode = 1;
  })
  .finally(closePool);

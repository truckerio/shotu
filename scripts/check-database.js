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

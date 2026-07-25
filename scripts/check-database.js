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
      (select count(*)::int from app_users) as users,
      (select count(*)::int from assets) as assets,
      (select count(*)::int from operational_workorders) as workorders,
      (select count(*)::int from v_workorder_operations) as operations_view,
      (select count(*)::int from operational_workorders where company_uuid is null) as workorders_without_company,
      (select count(*)::int from assets where company_uuid is null) as assets_without_company,
      (select count(*)::int from operational_workorders where location_id is null) as workorders_without_location,
      (
        select count(*)::int
        from operational_workorders workorder
        left join workorder_mechanic_assignments assignment
          on assignment.workorder_id = workorder.id
          and assignment.active
          and assignment.assignment_role = 'primary'
        where workorder.current_mechanic_id is distinct from assignment.mechanic_user_id
      ) as primary_assignment_drift
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
  if (report.primary_assignment_drift) failures.push("primary mechanic projection has drifted");

  console.log(JSON.stringify({ healthy: failures.length === 0, ...report, failures }));
  if (failures.length) process.exitCode = 1;
}

checkDatabase()
  .catch((error) => {
    console.error(JSON.stringify({ healthy: false, error: error.message }));
    process.exitCode = 1;
  })
  .finally(closePool);

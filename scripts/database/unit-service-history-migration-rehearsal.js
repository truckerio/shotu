import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const databaseUrl = String(process.env.DATABASE_URL || "").replace("postgresql+asyncpg:", "postgresql:");
const parsedUrl = new URL(databaseUrl);
const databaseName = decodeURIComponent(parsedUrl.pathname.slice(1));
if (!/^codex_unit_history_[a-z0-9_]+$/.test(databaseName)) {
  throw new Error("Migration rehearsal requires an isolated codex_unit_history_* database.");
}

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../src/server/db/migrations");
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort((left, right) => left.localeCompare(right));
const client = new pg.Client({ connectionString: databaseUrl });
const companyId = "00000000-0000-0000-0000-000000000001";
const assetId = "77777777-7777-4777-8777-777777777777";
const completedOrderId = "88888888-8888-4888-8888-888888888881";

await client.connect();
try {
  await client.query("begin");
  for (const name of migrationNames) {
    if (name === "057_unit_service_history_read_model.sql") {
      await client.query(
        `insert into assets (id, company_id, provider, unit_no, name)
         values ($1, $2, 'manual', 'QA-057', 'Migration rehearsal unit')`,
        [assetId, companyId],
      );
      await client.query(
        `insert into service_history_orders (
           id, company_id, source_provider, external_id, reference, status,
           asset_id, ordered_at, completed_at, source_updated_at, raw_metadata
         ) values
           ($1, $2, 'odoo', 'valid', 'SO-VALID', 'sale', $3, null, null, now(),
            '{"date_order":"2026-08-01T10:00:00Z","commitment_date":"2026-08-02T10:00:00Z","effective_date":"2026-08-03T10:00:00Z"}'),
           ('88888888-8888-4888-8888-888888888882', $2, 'odoo', 'boolean-false', 'SO-FALSE', 'sale', $3, null, null, now(),
            '{"date_order":false,"commitment_date":false,"effective_date":false}'),
           ('88888888-8888-4888-8888-888888888883', $2, 'odoo', 'malformed', 'SO-BAD', 'sale', $3, null, null, now(),
            '{"date_order":"not-a-date","commitment_date":"2026-99-99T10:00:00Z","effective_date":"2026-02-31T10:00:00Z"}'),
           ('88888888-8888-4888-8888-888888888884', $2, 'odoo', 'scheduled', 'SO-SCHEDULED', 'sale', $3, null, null, now(),
            '{"date_order":"2026-08-04T10:00:00Z","commitment_date":"2026-08-05T10:00:00Z","effective_date":false}')`,
        [completedOrderId, companyId, assetId],
      );
    }
    await client.query(await readFile(join(migrationsDirectory, name), "utf8"));
  }
  const dates = await client.query(
    `select external_id, completed_at, scheduled_at, recorded_at, completion_date_kind
     from service_history_orders where company_id = $1 order by external_id`,
    [companyId],
  );
  const byExternalId = new Map(dates.rows.map((row) => [row.external_id, row]));
  assert.equal(byExternalId.get("valid").completion_date_kind, "verified_completed");
  assert.ok(byExternalId.get("valid").completed_at);
  assert.equal(byExternalId.get("boolean-false").completed_at, null);
  assert.equal(byExternalId.get("malformed").completed_at, null);
  assert.equal(byExternalId.get("malformed").scheduled_at, null);
  assert.equal(byExternalId.get("scheduled").completion_date_kind, "scheduled");
  assert.equal(byExternalId.get("scheduled").completed_at, null);
  assert.ok(byExternalId.get("scheduled").scheduled_at);
  await client.query("commit");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}

const { closePool } = await import("../../src/server/db/pool.js");
const {
  listUnitServiceHistory,
  markServiceHistorySyncAttempted,
  markServiceHistorySyncFailed,
  markServiceHistorySyncSucceeded,
  readServiceHistorySyncState,
} = await import("../../src/server/db/repositories/service-history.repo.js");
try {
  const history = await listUnitServiceHistory(
    companyId,
    assetId,
    "99999999-9999-4999-8999-999999999999",
    { limit: 10 },
  );
  assert.equal(history.historyCount, 2);
  assert.equal(history.items.length, 2);
  assert.equal(history.items[0].reference, "SO-SCHEDULED");
  assert.equal(history.items[0].dateKind, "recorded");
  assert.equal(history.items[1].id, completedOrderId);
  assert.equal(history.items[1].dateKind, "verified_completed");
  assert.equal(history.items[1].reference, "SO-VALID");
  const oldAttempt = new Date("2026-08-24T10:00:00Z");
  const success = new Date("2026-08-24T11:00:00Z");
  const newerAttempt = new Date("2026-08-24T12:00:00Z");
  await markServiceHistorySyncAttempted(companyId, "odoo", success);
  await markServiceHistorySyncSucceeded(companyId, "odoo", { providerWatermark: success, reconciled: true });
  await markServiceHistorySyncFailed(companyId, "odoo", { attemptedAt: oldAttempt, code: "OLD_FAILURE" });
  let syncState = await readServiceHistorySyncState(companyId, "odoo");
  assert.equal(syncState.lastErrorCode, "");
  await markServiceHistorySyncAttempted(companyId, "odoo", newerAttempt);
  await markServiceHistorySyncFailed(companyId, "odoo", { attemptedAt: newerAttempt, code: "NEW_FAILURE" });
  await markServiceHistorySyncSucceeded(companyId, "odoo", {
    providerWatermark: new Date("2026-08-24T11:30:00Z"),
    reconciled: false,
  });
  syncState = await readServiceHistorySyncState(companyId, "odoo");
  assert.equal(syncState.lastErrorCode, "NEW_FAILURE");
  assert.equal(new Date(syncState.lastAttemptedAt).toISOString(), newerAttempt.toISOString());
  console.log("Unit service-history migration, repository, and sync-order rehearsal passed.");
} finally {
  await closePool();
}

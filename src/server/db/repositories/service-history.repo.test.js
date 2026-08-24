import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  decodeUnitHistoryCursor,
  encodeUnitHistoryCursor,
  rankPartRepairHistoryRows,
} from "./service-history.repo.js";

const migrationUrl = new URL("../migrations/045_service_repair_history.sql", import.meta.url);
const deleteCleanupMigrationUrl = new URL("../migrations/046_local_service_history_delete_cleanup.sql", import.meta.url);
const syncStateMigrationUrl = new URL("../migrations/047_service_history_sync_state.sql", import.meta.url);
const unitHistoryMigrationUrl = new URL("../migrations/057_unit_service_history_read_model.sql", import.meta.url);
const assetHistoryMigrationUrl = new URL("../migrations/060_odoo_asset_service_history_timeline.sql", import.meta.url);

function row(overrides = {}) {
  return {
    repair_text: "Replace trailer seal",
    confidence: "context",
    source_provider: "odoo",
    service_order_id: crypto.randomUUID(),
    external_id: "SO-1",
    reference: "SO-1",
    asset_id: null,
    used_at: "2026-01-01T00:00:00.000Z",
    evidence: {},
    ...overrides,
  };
}

test("confirmed repair history always ranks ahead of same-order Odoo context", () => {
  const rows = Array.from({ length: 12 }, (_, index) => row({
    service_order_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    repair_text: "Possible same-order repair",
  }));
  rows.push(row({
    confidence: "confirmed",
    source_provider: "local",
    repair_text: "Confirmed installed repair",
  }));
  const ranked = rankPartRepairHistoryRows(rows, { limit: 5 });
  assert.equal(ranked[0].text, "Confirmed installed repair");
  assert.equal(ranked[0].confidence, "confirmed");
});

test("ranking combines duplicate wording, favors frequency, vehicle, proximity, then recency", () => {
  const assetId = "11111111-1111-4111-8111-111111111111";
  const ranked = rankPartRepairHistoryRows([
    row({ repair_text: "  Put new hub seal,   adjust brakes ", asset_id: assetId, evidence: { proximityScore: 0.5 } }),
    row({ repair_text: "PUT NEW HUB SEAL, ADJUST BRAKES", used_at: "2026-02-01T00:00:00Z" }),
    row({ repair_text: "Replace another component", used_at: "2026-03-01T00:00:00Z" }),
  ], { assetId, limit: 2 });
  assert.equal(ranked[0].text, "Put new hub seal, adjust brakes");
  assert.equal(ranked[0].usageCount, 2);
  assert.equal(ranked[0].sameAsset, true);
  assert.equal(ranked[0].examples.length, 2);
});

test("service-history migration preserves ordered source lines and materializes local history", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table service_history_orders/i);
  assert.match(sql, /create table service_history_lines/i);
  assert.match(sql, /sequence numeric[\s\S]*line_index integer/i);
  assert.match(sql, /service_history_lines_order_sequence_idx/i);
  assert.match(sql, /part_repair_history_catalog_rank_idx/i);
  assert.match(sql, /jsonb_array_elements[\s\S]*form_data\s*->\s*'parts'/i);
  assert.match(sql, /refresh_local_part_repair_history/i);
  assert.match(sql, /confidence in \('confirmed', 'context'\)/i);
  assert.match(sql, /request\.approval_status = 'approved'/i);
});

test("deleting a local workorder cascades its service history and suggestions", async () => {
  const sql = await readFile(deleteCleanupMigrationUrl, "utf8");
  assert.match(sql, /after delete on operational_workorders/i);
  assert.match(sql, /delete from service_history_orders/i);
  assert.match(sql, /company_id = old\.company_id/i);
  assert.match(sql, /external_id = old\.id::text/i);
});

test("catalog identity owns matching while normalized number only restores legacy null links", async () => {
  const source = await readFile(new URL("./service-history.repo.js", import.meta.url), "utf8");
  assert.match(source, /with target_catalog as/i);
  assert.match(source, /history\.catalog_part_id = target\.id/i);
  assert.match(source, /history\.catalog_part_id is null[\s\S]*history\.normalized_part_number = target\.normalized_part_number/i);
  assert.doesNotMatch(source, /\$2::uuid is not null and history\.catalog_part_id = \$2\)\s*or \(\$3::text <>/i);
  assert.match(source, /group by canonical_text[\s\S]*order by[\s\S]*usage_count desc[\s\S]*limit \$5/i);
  assert.match(source, /count\(distinct service_order_id\)::int as usage_count/i);
});

test("provider history watermark and reconciliation state are durable and success-driven", async () => {
  const migration = await readFile(syncStateMigrationUrl, "utf8");
  const repository = await readFile(new URL("./service-history.repo.js", import.meta.url), "utf8");
  assert.match(migration, /provider_watermark timestamptz/i);
  assert.match(migration, /last_reconciled_at timestamptz/i);
  assert.match(repository, /markServiceHistorySyncSucceeded/i);
});

test("unit history cursor round-trips a deterministic date and row identity", () => {
  const input = {
    serviceAt: "2026-08-20T12:30:00.000Z",
    id: "11111111-1111-4111-8111-111111111111",
  };
  assert.deepEqual(decodeUnitHistoryCursor(encodeUnitHistoryCursor(input)), input);
  assert.throws(() => decodeUnitHistoryCursor("not-a-cursor"), (error) => (
    error.statusCode === 400 && error.code === "INVALID_SERVICE_HISTORY_CURSOR"
  ));
});

test("unit history query is tenant and exact-asset scoped, excludes current work, and deduplicates Odoo identity", async () => {
  const repository = await readFile(new URL("./service-history.repo.js", import.meta.url), "utf8");
  assert.match(repository, /history\.company_id = \$1[\s\S]*history\.asset_id = \$2::uuid/i);
  assert.match(repository, /workorder\.id <> \$3::uuid/i);
  assert.match(repository, /workorder\.closed_at is not null[\s\S]*history\.completion_date_kind = 'verified_completed'/i);
  assert.match(repository, /from odoo_entry_status entry[\s\S]*entry\.external_id = history\.external_id/i);
  assert.match(repository, /history\.source_provider = 'odoo'[\s\S]*history\.status in \('sale', 'done'\)[\s\S]*or history\.recorded_at is not null/i);
  assert.match(repository, /coalesce\(history\.completed_at, history\.recorded_at, history\.scheduled_at/i);
  assert.match(repository, /line\.line_kind = 'service'/i);
  assert.match(repository, /line\.line_kind = 'goods'/i);
  assert.doesNotMatch(repository, /raw_metadata:\s*row\./i);
  assert.doesNotMatch(repository, /raw_payload:\s*row\./i);
});

test("Asset Service History timeline indexes recorded Odoo service orders without promoting schedules", async () => {
  const migration = await readFile(assetHistoryMigrationUrl, "utf8");
  assert.match(migration, /coalesce\(completed_at, recorded_at, scheduled_at, ordered_at, source_updated_at\)/i);
  assert.match(migration, /completed_at is not null or recorded_at is not null/i);
  assert.doesNotMatch(migration, /set\s+completed_at\s*=/i);
});

test("unit history migration separates scheduled dates and records durable sync failure health", async () => {
  const migration = await readFile(unitHistoryMigrationUrl, "utf8");
  const repository = await readFile(new URL("./service-history.repo.js", import.meta.url), "utf8");
  assert.match(migration, /scheduled_at timestamptz/i);
  assert.match(migration, /completion_date_kind[\s\S]*verified_completed[\s\S]*scheduled/i);
  assert.match(migration, /scheduled_at = service_history_safe_timestamptz\(history\.raw_metadata -> 'commitment_date'\)/i);
  assert.match(migration, /exception when others then[\s\S]*return null/i);
  assert.match(migration, /service_history_orders_unit_timeline_idx/i);
  assert.match(migration, /last_attempted_at timestamptz[\s\S]*last_succeeded_at timestamptz[\s\S]*last_error_at timestamptz/i);
  assert.match(repository, /markServiceHistorySyncAttempted/i);
  assert.match(repository, /markServiceHistorySyncFailed/i);
});

test("unit history bounds every record payload and reports explicit truncation", async () => {
  const repository = await readFile(new URL("./service-history.repo.js", import.meta.url), "utf8");
  assert.match(repository, /MAX_HISTORY_TEXT_LENGTH = 4_000/i);
  assert.match(repository, /MAX_HISTORY_SERVICE_LINES = 25/i);
  assert.match(repository, /MAX_HISTORY_PARTS = 50/i);
  assert.match(repository, /left\(workorder\.concern, \$\{MAX_HISTORY_TEXT_LENGTH\}\)/i);
  assert.match(repository, /limit \$\{MAX_HISTORY_SERVICE_LINES \+ 1\}/i);
  assert.match(repository, /limit \$\{MAX_HISTORY_PARTS \+ 1\}/i);
  assert.match(repository, /truncated:\s*\{[\s\S]*serviceLines:[\s\S]*parts:/i);
  assert.match(repository, /bool_or\(length\(candidate\.description\) > \$\{MAX_HISTORY_LINE_TEXT_LENGTH\}/i);
});

test("sync health uses attempt timestamps to prevent stale completions from regressing state", async () => {
  const repository = await readFile(new URL("./service-history.repo.js", import.meta.url), "utf8");
  assert.match(repository, /provider_watermark = greatest\([\s\S]*service_history_sync_state\.provider_watermark[\s\S]*excluded\.provider_watermark/i);
  assert.match(repository, /last_succeeded_at = greatest\([\s\S]*excluded\.last_succeeded_at/i);
  assert.match(repository, /when excluded\.last_succeeded_at >= service_history_sync_state\.last_attempted_at then null/i);
  assert.match(repository, /when excluded\.last_attempted_at >= service_history_sync_state\.last_attempted_at[\s\S]*then excluded\.last_error_at/i);
  assert.doesNotMatch(repository, /set provider_watermark = excluded\.provider_watermark/i);
});

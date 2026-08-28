import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../db/migrations/071_inventory_count_imports.sql", import.meta.url), "utf8");
const legacySourceMigration = readFileSync(new URL("../../db/migrations/077_inventory_count_source_files.sql", import.meta.url), "utf8");
const sourceMigration = readFileSync(new URL("../../db/migrations/078_inventory_count_source_security.sql", import.meta.url), "utf8");
const reviewedBinMigration = readFileSync(new URL("../../db/migrations/079_inventory_count_reviewed_bin_location.sql", import.meta.url), "utf8");
const reviewAuditMigration = readFileSync(new URL("../../db/migrations/081_inventory_count_review_audit.sql", import.meta.url), "utf8");
const movementMigration = readFileSync(new URL("../../db/migrations/072_inventory_movement_generic_receipts.sql", import.meta.url), "utf8");
const authorityAuditMigration = readFileSync(new URL("../../db/migrations/073_inventory_count_authority_audit.sql", import.meta.url), "utf8");
const repository = readFileSync(new URL("../../db/repositories/inventory-count-imports.repo.js", import.meta.url), "utf8");
const routes = readFileSync(new URL("./inventory.routes.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../../../../frontend/src/features/inventory/InventoryWorkspace.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../../../../frontend/src/features/inventory/InventoryCountImportPanel.jsx", import.meta.url), "utf8");
const operationalTable = readFileSync(new URL("../../../../frontend/src/components/ui/OperationalDataTable.jsx", import.meta.url), "utf8");
const operationalTableStyles = readFileSync(new URL("../../../../frontend/src/components/ui/operational-data-table.css", import.meta.url), "utf8");

test("stock count migration preserves draft evidence and separates it from seller invoices", () => {
  assert.match(migration, /create table inventory_count_imports/i);
  assert.match(migration, /create table inventory_count_import_lines/i);
  assert.match(migration, /source_sha256 char\(64\)/i);
  assert.match(legacySourceMigration, /source_file_bytes bytea/i);
  assert.match(sourceMigration, /source_ciphertext bytea/i);
  assert.match(sourceMigration, /drop column source_file_bytes/i);
  assert.match(sourceMigration, /octet_length\(source_auth_tag\) = 16/i);
  assert.match(sourceMigration, /inventory_count_source_access_events/i);
  assert.match(reviewedBinMigration, /reviewed_bin_location/i);
  assert.match(reviewedBinMigration, /set reviewed_bin_location = source_bin_location/i);
  assert.match(reviewAuditMigration, /create table inventory_count_review_events/i);
  assert.match(reviewAuditMigration, /actor_id uuid not null references user_profiles/i);
  assert.match(reviewAuditMigration, /before_state jsonb not null/i);
  assert.match(reviewAuditMigration, /after_state jsonb not null/i);
  assert.match(migration, /provider in \('odoo', 'local', 'local_count'\)/i);
  assert.match(migration, /provider = 'local_count' and invoice_run_id is null and count_import_id is not null/i);
  assert.match(migration, /purpose in \('receipt', 'stock_count'\)/i);
  assert.match(movementMigration, /references inventory_receipts\(company_id, id\)/i);
  assert.match(movementMigration, /references inventory_receipt_lines\(company_id, id\)/i);
  assert.match(authorityAuditMigration, /references inventory_receipts\(company_id, id\)/i);
  assert.match(authorityAuditMigration, /references inventory_receipt_lines\(company_id, id\)/i);
});

test("stock count apply is scoped, locked, idempotent, serialized, and fails closed on existing local stock", () => {
  assert.match(repository, /company_id = any\(\$2::uuid\[\]\)/i);
  assert.match(repository, /pg_advisory_xact_lock/i);
  assert.match(repository, /count-import:\$\{stocktake\.id\}:row:/i);
  assert.match(repository, /source_provider = 'local'/i);
  assert.match(repository, /\) do nothing\s+returning id/i);
  assert.match(repository, /totalUnits > 500/i);
  assert.match(repository, /> 100_000_000/i);
  assert.match(repository, /inventory_count_source_access_events/i);
  assert.match(repository, /source_retention_until <= now\(\)/i);
  assert.doesNotMatch(repository, /select stocktake\.\*/i);
  assert.match(repository, /reviewed_bin_location = \$6/i);
  assert.match(repository, /line\.reviewed_bin_location/i);
  assert.match(repository, /quantity_reserved/i);
  assert.match(repository, /inventory_serialized_units/i);
  assert.match(repository, /purpose: "stock_count"/i);
  assert.match(repository, /chunksByUnitLimit\(ready\.rows\)/i);
  assert.doesNotMatch(repository, /insert into inventory_authority_cutovers/i);
  assert.match(repository, /insert into inventory_count_review_events/i);
  assert.match(repository, /JSON\.stringify\(reviewState\(line\.rows\[0\]\)\)/i);
  assert.match(repository, /JSON\.stringify\(reviewState\(updatedLine\.rows\[0\]\)\)/i);
  const listSource = repository
    .slice(repository.indexOf("export async function listInventoryCountImports"))
    .split("export async function deleteExpiredInventoryCountSources")[0];
  assert.doesNotMatch(listSource, /select stocktake\.\*/i);
  assert.doesNotMatch(listSource, /source_ciphertext[^\n]*,/i);
});

test("inventory UI keeps count upload inside Inventory and requires physical confirmation", () => {
  assert.match(workspace, /InventoryCountImportPanel/);
  assert.match(workspace, />Count<\/Button>/);
  assert.match(panel, /MAX_FILE_BYTES = 2_000_000/);
  assert.match(panel, /MAX_ROWS = 500/);
  assert.match(panel, /Counted at \{stocktake\.locationName\}/);
  assert.match(panel, /confirmation: "physically_counted"/);
  assert.match(panel, /setConfirmed\(false\);\s*\}, \[stocktake\?\.version\]\)/);
  assert.match(panel, /import\("exceljs\/dist\/exceljs\.min\.js"\)/);
});

test("inventory count review uses the shared accessible table and canonical bin or shelf field", () => {
  assert.match(panel, /OperationalDataTable/);
  assert.match(panel, /label: "Bin \/ shelf"/);
  assert.match(panel, /binLocation/);
  assert.match(panel, /inventory-count-attestation/);
  assert.match(panel, /PartCatalogCombobox/);
  assert.match(panel, /useState\(suggestedQuery\)/);
  assert.match(panel, /catalogEndpoint="\/api\/office\/inventory\/catalog"/);
  assert.match(panel, /resultLimit=\{12\}/);
  assert.match(panel, /automaticSearchQuery = String\(line\.sourcePartName \|\| line\.sourceDescription \|\| line\.sourcePartNumber/);
  assert.match(panel, /suggestionQuery=\{useSpreadsheetSuggestions \? automaticSearchQuery : ""\}/);
  assert.match(panel, /setUseSpreadsheetSuggestions\(false\)/);
  assert.match(panel, /Select to view suggested matches/);
  assert.match(operationalTable, /TableHeader/);
  assert.match(operationalTable, /TableBody/);
  assert.match(operationalTable, /aria-label=\{ariaLabel\}/);
  assert.match(operationalTable, /containEditorNavigation/);
  assert.match(operationalTable, /event\.target !== event\.currentTarget[\s\S]*?event\.stopPropagation\(\)/);
  assert.match(operationalTable, /TableStateContext/);
  assert.match(operationalTable, /setKeyboardNavigationDisabled\(true\)/);
  assert.match(operationalTable, /setKeyboardNavigationDisabled\(false\)/);
  assert.match(operationalTableStyles, /@media \(max-width: 760px\)/);
  assert.match(operationalTableStyles, /content: attr\(data-label\)/);
});

test("inventory routes expose review, resolution, apply, and master search without a new top-level module", () => {
  assert.match(routes, /\/api\/office\/inventory\/catalog/);
  assert.match(routes, /\/api\/office\/inventory\/count-imports/);
  assert.match(routes, /resolveInventoryCountLine/);
  assert.match(routes, /confirmInventoryCount/);
});

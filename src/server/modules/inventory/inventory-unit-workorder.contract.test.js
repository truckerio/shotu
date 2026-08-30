import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../../db/migrations/069_inventory_unit_workorder_usage.sql", import.meta.url), "utf8");
const reservationMigration = readFileSync(new URL("../../db/migrations/087_workorder_serialized_part_reservation_lifecycle.sql", import.meta.url), "utf8");
const repairOrderMigration = readFileSync(new URL("../../db/migrations/089_serialized_usage_repair_order.sql", import.meta.url), "utf8");
const repository = readFileSync(new URL("../../db/repositories/inventory-unit-workorder-usage.repo.js", import.meta.url), "utf8");
const workorders = readFileSync(new URL("../../db/repositories/operational-workorders.repo.js", import.meta.url), "utf8");
const server = readFileSync(new URL("../../../../server.js", import.meta.url), "utf8");
const partsModule = readFileSync(new URL("../../../../frontend/src/features/workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");
const service = readFileSync(new URL("./inventory-unit-workorder.service.js", import.meta.url), "utf8");
const providerPolicy = readFileSync(new URL("../../../../shared/inventory-provider.js", import.meta.url), "utf8");

test("serialized usage migration enforces tenant FKs, one unresolved unit, and exact idempotency", () => {
  assert.match(migration, /foreign key \(company_id, workorder_id\) references operational_workorders\(company_id, id\)/i);
  assert.match(migration, /foreign key \(company_id, unit_id\) references inventory_serialized_units\(company_id, id\)/i);
  assert.match(migration, /where status = 'issued'/i);
  assert.match(migration, /unique \(company_id, issued_by_user_id, issue_idempotency_key\)/i);
  assert.match(migration, /finalize_request_hash char\(64\)/i);
});

test("serialized usage evidence is append-only and stock movements link unit, usage, workorder, and asset", () => {
  assert.match(migration, /event_type in \([\s\S]*'issued'[\s\S]*'installed'[\s\S]*'returned'/i);
  assert.match(migration, /inventory_stock_movements_usage_action_idx/i);
  assert.match(migration, /movement_type in \('issue', 'return'\)/i);
  assert.match(repository, /insert into inventory_unit_events/i);
  assert.doesNotMatch(repository, /update inventory_unit_events/i);
  assert.match(repository, /insert into inventory_stock_movements/i);
  assert.doesNotMatch(repository, /update inventory_stock_movements/i);
});

test("reservation lifecycle preserves legacy issue while approval owns new consumption", () => {
  assert.match(reservationMigration, /'reserved', 'installed_pending_approval'/i);
  assert.match(reservationMigration, /workorder_serialized_part_usage_commands/i);
  assert.match(reservationMigration, /'removed_returned_to_stock'/i);
  assert.match(reservationMigration, /status in \('installed_pending_approval', 'installed', 'returned', 'removed'\)[\s\S]*finalized_by_user_id is not null[\s\S]*finalize_request_hash is not null/i);
  assert.match(repository, /quantity_on_hand - quantity_reserved >= 1/i);
  assert.match(repository, /quantity_reserved = quantity_reserved \+ 1/i);
  assert.match(repository, /consumePendingSerializedInstallationsForApproval/i);
  assert.match(repository, /quantity_on_hand = quantity_on_hand - 1,[\s\S]*quantity_reserved = quantity_reserved - 1/i);
  assert.match(workorders, /consumePendingSerializedInstallationsForApproval\(client/i);
  assert.match(workorders, /inventory_unit_events inventory_event[\s\S]*inventory_event\.workorder_id = \$1/i);
  assert.match(workorders, /line\.part_number,[\s\S]*unit\.serial_number/i);
  assert.match(repository, /pendingInstall[\s\S]*"removed_returned_to_stock"/i);
});

test("installed-part summaries are tenant scoped, per usage, repair-order aware, and bounded", () => {
  assert.match(repository, /listWorkorderInstalledSerializedParts/);
  assert.match(repository, /usage\.workorder_id = \$1[\s\S]*usage\.company_id = \$2[\s\S]*usage\.location_id = \$3/i);
  assert.match(repository, /usage\.status in \('installed_pending_approval', 'installed'\)/i);
  assert.match(repository, /usage\.id as usage_id/i);
  assert.match(repository, /repairOrder: row\.repair_order/i);
  assert.doesNotMatch(repository, /group by usage\.catalog_part_id, line\.part_number, usage\.uom_code/i);
  assert.match(repository, /limit \$4/i);
  assert.match(repository, /limit = 2000/i);
});

test("serialized repair wording snapshots receipt description and keeps a field-event audit", () => {
  assert.match(repairOrderMigration, /add column repair_order text not null default ''/i);
  assert.match(repairOrderMigration, /inventory_receipt_lines/i);
  assert.match(repository, /line\.description/i);
  assert.match(repository, /serialized_usage_repair_order/i);
  assert.match(repository, /update workorder_serialized_part_usages[\s\S]*set repair_order/i);
  assert.match(workorders, /activeSerializedRepairOrders/);
  assert.match(workorders, /\[\.\.\.\(before\.form_data\?\.parts \|\| \[\]\), \.\.\.serializedParts\]/);
});

test("repository locks workorder, exact unit, usage, and local balance before mutation", () => {
  assert.match(repository, /for update of workorder/i);
  assert.match(repository, /for update of unit/i);
  assert.match(repository, /for update of usage, unit/i);
  assert.match(repository, /source_provider = 'local'/i);
  assert.match(repository, /receipt\.provider/i);
  assert.match(repository, /quantity_on_hand = quantity_on_hand - 1/i);
  assert.match(repository, /quantity_reserved = quantity_reserved \+ 1/i);
  assert.match(repository, /quantity_on_hand = quantity_on_hand \+ 1/i);
  assert.match(repository, /isApplicationOwnedInventoryProvider\(unit\.provider\)/);
  assert.match(service, /isApplicationOwnedInventoryProvider\(unit\.provider\)/);
  assert.match(providerPolicy, /"local_count"/);
  assert.match(providerPolicy, /"local_serialization"/);
});

test("serialized workflow is Office-owned, module-authorized, and mounted inside canonical Parts", () => {
  assert.match(server, /handleInventoryUnitWorkorderApi/);
  assert.match(partsModule, /<SerializedPartsScanner/);
  assert.match(partsModule, /partsVisible \? <PartRequestsPanel/);
  assert.match(service, /moduleKey: "partsScanning"/);
  assert.match(service, /requireLocationAccess/);
  assert.match(service, /getWorkorderMechanicPartsPolicy/);
  assert.doesNotMatch(repository, /mechanic_can_record_parts/);
  assert.match(repository, /workorder_parts_scan/);
});

test("workorder lifecycle blocks unresolved exact-unit issues", () => {
  assert.match(workorders, /WORKORDER_SERIALIZED_PARTS_PENDING/);
  assert.match(workorders, /assertNoUnresolvedSerializedParts\(client, workorderId/);
  assert.match(workorders, /changing the workorder unit or location/);
  assert.match(workorders, /before cancelling this workorder/);
  assert.match(workorders, /before changing the mechanic assignment/);
  assert.match(workorders, /before leaving this workorder/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./InventoryReports.jsx", import.meta.url), "utf8");

test("inventory reports show concise custody facts and friendly lifecycle labels", () => {
  assert.match(source, /Removed parts \/ custody/);
  for (const label of [
    "Awaiting handoff",
    "Pending inspection",
    "On hold",
    "In repair",
    "Quarantined",
    "Core return pending",
    "Scrap approval pending",
    "Released to stock",
    "Core returned",
    "Scrapped",
  ]) assert.match(source, new RegExp(label));
  assert.match(source, /ariaLabel="Removed parts and custody"/);
  assert.match(source, /Part \/ serial/);
  assert.match(source, /Unit \/ workorder/);
  assert.match(source, /Location \/ disposition/);
  assert.match(source, /Purchase record/);
  assert.match(source, /item\.invoice_number \|\| item\.invoice_file_name/);
  assert.match(source, /Receipt \{item\.receipt_id/);
});

test("custody report keeps unknown evidence unknown and links only to canonical owners", () => {
  assert.match(source, /return .*\? "Unknown"/);
  assert.match(source, /workorderDetailSearch\(item\.original_workorder_id\)/);
  assert.match(source, /workorderDetailSearch\(item\.removal_workorder_id\)/);
  assert.match(source, /taskOwner: "custody"/);
  assert.match(source, /reuseCaseId: item\.id/);
  assert.match(source, /taskLocation: locationId/);
  assert.doesNotMatch(source, /onClick=.*(?:release|receive|repair|scrap|core)/i);
});

test("custody report communicates its fixed result bound", () => {
  assert.match(source, /data\.custody\?\.hasMore/);
  assert.match(source, /Showing the latest \{data\.custody\.limit\} custody records/);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shared = readFileSync(new URL("./WorkorderPartsEntryTable.jsx", import.meta.url), "utf8");
const create = readFileSync(new URL("../../features/workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./UsedPartsEditor.jsx", import.meta.url), "utf8");

test("Create and one-page Detail share one entry-table header and labor-row owner", () => {
  assert.match(shared, /DEFAULT_WORKORDER_PARTS_COLUMNS/);
  assert.match(shared, /WORKORDER_PARTS_COLUMNS\.PRICE/);
  assert.match(shared, /<WorkorderPartsColumnHead/);
  assert.match(shared, /<WorkorderPartsRow className="operational-part-labor-row used-part-labor-row"/);
  assert.match(shared, /<strong>1<\/strong>/);
  assert.match(create, /<WorkorderPartsEntryTable/);
  assert.match(detail, /<WorkorderPartsEntryTable/);
});

test("shared presentation keeps Create drafts and Detail recording lifecycles with their existing owners", () => {
  assert.match(create, /parts\.map\(\(part, index\) => \(/);
  assert.match(create, /onChange\(index, catalogPartSelection/);
  assert.match(detail, /activeSerializedParts\.map/);
  assert.match(detail, /recordedManualParts\.map/);
  assert.match(detail, /visibleDraftRows\.map/);
  assert.doesNotMatch(shared, /PartCatalogCombobox|onSaveParts|serializedParts|api\(/);
});

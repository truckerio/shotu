import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emptyPart,
  renderWorkorderPageHtml,
} from "../../../../shared/workorder-template.js";
import { laborProductLabel } from "../../../../shared/labor-product.js";

const createForm = readFileSync(new URL("./CreateWorkorderForm.jsx", import.meta.url), "utf8");
const createPartsModule = readFileSync(new URL("../workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8");
const createPartScanner = readFileSync(new URL("../workorder-modules/parts/CreatePartScanner.jsx", import.meta.url), "utf8");
const createPartsCss = readFileSync(new URL("../workorder-modules/parts/create-parts-module.css", import.meta.url), "utf8");
const detailPartsModule = readFileSync(new URL("../workorder-modules/parts/WorkorderPartsModule.jsx", import.meta.url), "utf8");
const formController = readFileSync(new URL("../../app/routes/useRoleRouterFormController.js", import.meta.url), "utf8");
const readOnlyParts = readFileSync(new URL("../../components/workorders/part-requests/ReadOnlyPartsSurface.jsx", import.meta.url), "utf8");
const usedPartsEditor = readFileSync(new URL("../../components/workorders/UsedPartsEditor.jsx", import.meta.url), "utf8");

test("create and mechanic save paths serialize uomCode", () => {
  assert.match(createForm, /WorkorderCreateModuleHost/);
  assert.match(createPartsModule, /<QuantityUnitInput/);
  assert.match(createPartsModule, /onChange\(index, "uomCode", value\)/);
  assert.match(formController, /qty:\s*part\.qty,\s*\n\s*uomCode:\s*part\.uomCode,/);
});

test("preview prints quantity with the selected symbol and piece fallback", () => {
  const html = renderWorkorderPageHtml({
    parts: [
      { partNo: "COOLANT", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
      { partNo: "FILTER", qty: "1", repairOrder: "Replace" },
    ],
  }, "WO-UOM-1");

  assert.match(html, />2\.5 gal</);
  assert.match(html, />1 pc</);
  assert.deepEqual(emptyPart(), { partNo: "", qty: "", uomCode: "pc", repairOrder: "" });
});

test("surveillance read-only parts use the shared quantity formatter", () => {
  assert.match(readOnlyParts, /UsedPartsSection/);
  assert.match(usedPartsEditor, /formatQuantityUnit\(part\.qty, part\.uomCode\)/);
  assert.doesNotMatch(usedPartsEditor, /part\.qty \|\| 1/);
});

test("AI part suggestions retain quantity and unit in the shared used-parts row", () => {
  assert.match(usedPartsEditor, /qty:\s*defaultUsedPartQuantity\(result\.part\.suggestedQuantity \|\| row\.qty\)/);
  assert.match(usedPartsEditor, /uomCode:\s*result\.part\.uomCode \|\| row\.uomCode/);
});

test("catalog selections default blank used-part quantities to one", () => {
  assert.match(usedPartsEditor, /partNo:\s*catalogPart\.partNumber,[\s\S]*qty:\s*defaultUsedPartQuantity\(part\.qty\)/);
});

test("typed part numbers default blank quantities before autosave", () => {
  assert.match(usedPartsEditor, /partNo:\s*value,[\s\S]*qty:\s*usedPartQuantityAfterPartNumberChange\(part, value\)/);
});

test("create workorder uses the location-scoped catalog selector and retains selected identity", () => {
  assert.match(createForm, /locationId:\s*form\.locationId/);
  assert.match(createPartsModule, /<PartCatalogCombobox/);
  assert.match(createPartsModule, /locationId=\{locationId\}/);
  assert.match(createPartsModule, /catalogPartId:\s*catalogPart\.id/);
  assert.match(createPartsModule, /qty:\s*defaultUsedPartQuantity\(part\.qty\)/);
  assert.match(createPartsModule, /repairOrder:\s*repairOrderAfterCatalogSelection\(part\.repairOrder, catalogPart\)/);
  assert.match(formController, /typeof field === "object"[\s\S]*\.\.\.patch/);
});

test("create parts place compact approved and scan actions together without claiming exact issuance", () => {
  assert.match(createPartsModule, /className="create-parts-actions"/);
  assert.match(createPartsModule, /create\.parts\.add/);
  assert.match(createPartsModule, /<CreatePartScanner/);
  assert.match(createPartsModule, /create\.parts\.scanDraftHelp/);
  assert.match(createPartScanner, /api\("\/api\/inventory\/resolve"/);
  assert.match(createPartScanner, /isApplicationOwnedInventoryProvider\(unit\.receipt\?\.provider\)/);
  assert.match(createPartScanner, /unit\.locationId !== locationId/);
  assert.match(createPartScanner, /unit\.status !== "in_stock"/);
  assert.doesNotMatch(createPartScanner, /inventory-units\/issue/);
  assert.match(createPartsCss, /min-height:\s*44px/);
  assert.match(createPartsCss, /@media \(max-width: 420px\)/);
});

test("create parts show configured labor first and avoid duplicate visible row numbering", () => {
  assert.match(createForm, /laborHours:\s*form\.laborHours/);
  assert.match(createForm, /onFieldChange\("laborHours", value\)/);
  assert.match(createForm, /onFieldChange\("workPerformed", value\)/);
  assert.match(createPartsModule, /laborProductLabel\(laborProduct\)/);
  assert.match(createPartsModule, /aria-label=\{t\("create\.parts\.repairWork"\)\}/);
  assert.match(createPartsModule, /onLaborRepairOrderChange\(event\.target\.value\)/);
  assert.equal(laborProductLabel({ code: "LAB200", name: "Shop labor" }), "[LAB200] Shop labor");
  assert.match(createPartsModule, /<strong>\{index \+ 2\}<\/strong>/);
  assert.match(createPartsModule, /label=""/);
  assert.doesNotMatch(createPartsModule, /<span>Labor<\/span>/);
  assert.doesNotMatch(createPartsModule, /label=\{`Part number \$\{index \+ 1\}`\}/);
});

test("detail parts use the same configured labor product label as create and print", () => {
  assert.match(usedPartsEditor, /laborProductLabel\(laborProduct\)/);
  assert.match(usedPartsEditor, /aria-label=\{t\("parts\.repairOrderWorkPerformed"\)\}/);
  assert.match(usedPartsEditor, /onLaborRepairOrderChange\(event\.target\.value\)/);
  assert.match(usedPartsEditor, /repairOrder:\s*repairOrderAfterCatalogSelection\(part\.repairOrder, catalogPart\)/);
  assert.match(detailPartsModule, /laborRepairOrderDisabled=\{!activeWorkorder\.allowedActions\?\.saveNotes\}/);
  assert.equal(usedPartsEditor.match(/disabled=\{disabled \|\| laborRepairOrderDisabled\}/g)?.length, 2);
  assert.doesNotMatch(usedPartsEditor, /\[PTR001\] LABOR HOURS/);
});

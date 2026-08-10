import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emptyPart,
  renderWorkorderPageHtml,
} from "../../../../shared/workorder-template.js";

const createForm = readFileSync(new URL("./CreateWorkorderForm.jsx", import.meta.url), "utf8");
const createPartsModule = readFileSync(new URL("../workorder-modules/parts/CreatePartsModule.jsx", import.meta.url), "utf8");
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

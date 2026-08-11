import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { missingOdooWorkorderFields } from "./workorder-odoo-model.js";

const panelSource = readFileSync(new URL("./WorkorderOdooPanel.jsx", import.meta.url), "utf8");

test("Odoo missing information follows draft requirements, not optional diagnosis or mechanic fields", () => {
  assert.deepEqual(missingOdooWorkorderFields({
    concern: "Service engine",
    diagnosis: "",
    workPerformed: "Replace fuel filter",
    asset: { unitNo: "2622" },
    mechanics: [],
  }), []);
});

test("Odoo missing information uses the Repair order label", () => {
  assert.deepEqual(missingOdooWorkorderFields({}), ["Concern", "Repair order", "Unit"]);
  assert.match(panelSource, /<span>Repair order<\/span>/);
  assert.doesNotMatch(panelSource, /<span>Diagnosis<\/span>/);
  assert.doesNotMatch(panelSource, /<span>Work performed<\/span>/);
});

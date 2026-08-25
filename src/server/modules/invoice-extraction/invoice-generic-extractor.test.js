import assert from "node:assert/strict";
import test from "node:test";
import { extractGenericInvoiceDraft, genericDraftHasEvidence } from "./invoice-generic-extractor.js";

const region = (text, x, y, width, height, confidence = 0.96) => ({ text, x, y, width, height, confidence });

test("generic local extractor creates the first review draft without vendor-specific rules", () => {
  const observation = {
    width: 1,
    height: 1,
    regions: [
      region("Velocity Truck Centers", 0.08, 0.07, 0.22, 0.03),
      region("PARTS INVOICE", 0.55, 0.07, 0.16, 0.02),
      region("Invoice number", 0.55, 0.11, 0.13, 0.02),
      region("XC240109567:01", 0.72, 0.11, 0.14, 0.02),
      region("QTY", 0.08, 0.35, 0.05, 0.02),
      region("ITEM", 0.18, 0.35, 0.07, 0.02),
      region("DESCRIPTION", 0.36, 0.35, 0.15, 0.02),
      region("UNIT PRICE", 0.72, 0.35, 0.1, 0.02),
      region("EXTD PRICE", 0.86, 0.35, 0.1, 0.02),
      region("5", 0.08, 0.4, 0.03, 0.02),
      region("240VBW289714N", 0.18, 0.4, 0.14, 0.02),
      region("QUICK RELEASE VALVE", 0.36, 0.4, 0.22, 0.02),
      region("75.99", 0.74, 0.4, 0.07, 0.02),
      region("379.95", 0.88, 0.4, 0.07, 0.02),
      region("TOTAL", 0.72, 0.75, 0.08, 0.02),
      region("$409.40", 0.86, 0.75, 0.1, 0.02),
    ],
  };
  const draft = extractGenericInvoiceDraft({ observation, ocrText: "PARTS INVOICE\n$409.40" });
  assert.equal(draft.vendorName.value, "Velocity Truck Centers");
  assert.equal(draft.invoiceNumber.value, "XC240109567:01");
  assert.equal(draft.total.value, 409.4);
  assert.equal(draft.lines[0].partNumber.value, "240VBW289714N");
  assert.equal(draft.lines[0].quantity.value, 5);
  assert.equal(genericDraftHasEvidence(draft), true);
  assert.match(draft.warnings[0], /review required/i);
});

test("generic local extractor preserves uncertainty when a table is absent", () => {
  const draft = extractGenericInvoiceDraft({
    observation: { width: 1, height: 1, regions: [region("Unreadable receipt", 0.1, 0.1, 0.2, 0.03)] },
    ocrText: "Unreadable receipt",
  });
  assert.equal(draft.lines.length, 0);
  assert.equal(genericDraftHasEvidence(draft), false);
  assert.ok(draft.warnings.some((warning) => /No line-item table/.test(warning)));
});

test("generic local extractor keeps same-row totals and ignores website vendor candidates", () => {
  const observation = {
    width: 1,
    height: 1,
    regions: [
      region("PARTS INVOICE#XC240109567:01", 0.56, 0.148, 0.2, 0.016),
      region("Los Angeles Freightliner", 0.31, 0.171, 0.15, 0.011),
      region("on of Velocity Vehicle Group", 0.351, 0.189, 0.132, 0.007, 0.91),
      region("www.VelocityVehicleGroup.com", 0.32, 0.217, 0.15, 0.01),
      region("SUB-TOTAL", 0.67, 0.454, 0.068, 0.01),
      region("$379.95", 0.814, 0.453, 0.046, 0.009),
      region("TAX", 0.67, 0.464, 0.031, 0.011),
      region("$29.45", 0.82, 0.463, 0.04, 0.008),
      region("SHIPPING", 0.673, 0.474, 0.055, 0.01),
      region(".00", 0.844, 0.474, 0.017, 0.006),
      region("TOOTL", 0.673, 0.483, 0.043, 0.011),
      region("S409.40", 0.82, 0.483, 0.04, 0.007),
    ],
  };
  const draft = extractGenericInvoiceDraft({ observation, ocrText: "PARTS INVOICE\n$409.40" });
  assert.equal(draft.vendorName.value, "Los Angeles Freightliner");
  assert.equal(draft.invoiceNumber.value, "XC240109567:01");
  assert.equal(draft.subtotal.value, 379.95);
  assert.equal(draft.tax.value, 29.45);
  assert.equal(draft.shipping.value, 0);
  assert.equal(draft.total.value, 409.4);
});

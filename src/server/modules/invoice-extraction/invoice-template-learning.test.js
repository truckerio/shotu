import assert from "node:assert/strict";
import test from "node:test";
import {
  buildInvoiceDraftFromTemplate,
  extractTemplateFieldCandidates,
  extractTemplateLineCandidates,
  learnInvoiceTemplateCandidate,
  localTemplateDraftIsUsable,
  matchInvoiceTemplate,
  normalizeOcrObservation,
} from "./invoice-template-learning.js";

function region(text, x, y, width, height, confidence = 0.96) {
  return { text, x, y, width, height, confidence };
}

function observation({ invoiceNumber = "XC240109567:01", total = "$409.40", vendor = "Velocity Truck Centers" } = {}) {
  return {
    width: 1000,
    height: 1400,
    regions: [
      region(vendor, 80, 100, 260, 45),
      region("PARTS INVOICE", 590, 90, 160, 30),
      region("Invoice number", 590, 130, 135, 24),
      region(invoiceNumber, 760, 130, 170, 24),
      region("Bill to Purchaser", 90, 260, 170, 24),
      region("Deliver to", 560, 260, 110, 24),
      region("ITEM", 190, 520, 70, 22),
      region("DESCRIPTION", 380, 520, 150, 22),
      region("UNIT PRICE", 750, 520, 105, 22),
      region("EXTD PRICE", 875, 520, 110, 22),
      region("240VBW289714N", 190, 565, 170, 24),
      region("QUICK RELEASE VALVE", 380, 565, 245, 24),
      region("75.99", 775, 565, 70, 24),
      region("379.95", 885, 565, 80, 24),
      region("TOTAL", 730, 1040, 90, 26),
      region(total, 865, 1040, 100, 26),
    ],
  };
}

function reviewedDraft() {
  const field = (value) => ({ value, confidence: 100, evidence: "approved" });
  return {
    vendorName: field("Velocity Truck Centers"),
    documentType: field("invoice"),
    vendorAccount: field(""),
    invoiceNumber: field("XC240109567:01"),
    invoiceDate: field(""),
    purchaseOrderNumber: field(""),
    currency: field("USD"),
    subtotal: field(379.95),
    tax: field(29.45),
    shipping: field(0),
    total: field(409.4),
    lines: [{
      id: "line-1",
      partNumber: field("240VBW289714N"),
      description: field("QUICK RELEASE VALVE"),
      quantity: field(5),
      unitOfMeasure: field("EA"),
      unitPrice: field(75.99),
      lineTotal: field(379.95),
    }],
  };
}

test("normalizes pixel OCR regions into page-relative geometry", () => {
  const normalized = normalizeOcrObservation(observation());
  assert.equal(normalized.regions[0].box.x, 0.08);
  assert.equal(normalized.regions[0].box.y, 0.0714);
  assert.equal(normalized.regions[0].confidence, 0.96);
});

test("learns structure from approved truth without retaining invoice values", () => {
  const template = learnInvoiceTemplateCandidate({ observation: observation(), reviewedDraft: reviewedDraft() });
  assert.ok(template.fieldAnchors.some((anchor) => anchor.fieldPath === "invoiceNumber"));
  assert.ok(template.fieldAnchors.some((anchor) => anchor.fieldPath === "total"));
  assert.ok(template.tableColumns.some((column) => column.fieldName === "partNumber"));
  assert.match(template.fingerprint, /^[0-9a-f]{64}$/);

  const serialized = JSON.stringify(template);
  for (const sensitiveValue of ["XC240109567", "240VBW289714N", "409.40", "QUICK RELEASE VALVE", "Velocity Truck Centers"]) {
    assert.equal(serialized.includes(sensitiveValue), false);
  }
  assert.ok(template.signatureMarkers.every((marker) => /^[0-9a-f]{64}$/.test(marker)));
  assert.ok(template.signatureRegions.every((marker) => /^[0-9a-f]{64}$/.test(marker.digest)));
  assert.ok(template.fieldAnchors.flatMap((anchor) => anchor.labels).every((label) => /^[0-9a-f]{64}$/.test(label)));
});

test("matches a changed invoice from the same layout and rejects a different layout", () => {
  const template = learnInvoiceTemplateCandidate({ observation: observation(), reviewedDraft: reviewedDraft() });
  const sameLayout = observation({ invoiceNumber: "XC240109219:01", total: "$1,545.06" });
  assert.equal(matchInvoiceTemplate(sameLayout, template).matched, true);

  const differentLayout = {
    width: 1000,
    height: 1400,
    regions: [
      region("Rush Truck Centers", 100, 100, 220, 40),
      region("Picked Up By Customer", 320, 260, 300, 30),
      region("CUSTOMER PO", 80, 430, 150, 24),
      region("MAIN NUMBER", 500, 430, 160, 24),
      region("BALANCE DUE", 700, 980, 150, 24),
    ],
  };
  assert.equal(matchInvoiceTemplate(differentLayout, template).matched, false);

  const movedLayout = observation({ invoiceNumber: "XC240109219:01", total: "$1,545.06" });
  movedLayout.regions = movedLayout.regions.map((item) => ({ ...item, y: Math.max(0, item.y - 280) }));
  assert.equal(matchInvoiceTemplate(movedLayout, template).matched, false);
});

test("extracts anchor candidates locally and refuses ambiguous values", () => {
  const template = learnInvoiceTemplateCandidate({ observation: observation(), reviewedDraft: reviewedDraft() });
  const next = observation({ invoiceNumber: "XC240109219:01", total: "$1,545.06" });
  const extracted = extractTemplateFieldCandidates(next, template);
  assert.equal(extracted.fields.invoiceNumber.text, "XC240109219:01");
  assert.equal(extracted.fields.total.text, "$1,545.06");

  next.regions.push(region("$1,500.00", 865, 1040, 100, 26, 0.95));
  const ambiguous = extractTemplateFieldCandidates(next, template);
  assert.equal(ambiguous.fields.total, undefined);
  assert.ok(ambiguous.warnings.includes("total: ambiguous anchor"));
});

test("builds a reviewable local draft from a matching learned table", () => {
  const template = learnInvoiceTemplateCandidate({ observation: observation(), reviewedDraft: reviewedDraft() });
  const next = observation({ invoiceNumber: "XC240109219:01", total: "$1,545.06" });
  const table = extractTemplateLineCandidates(next, template);
  assert.equal(table.lines.length, 1);
  const localDraft = buildInvoiceDraftFromTemplate({ observation: next, template });
  assert.equal(localDraft.invoiceNumber.value, "XC240109219:01");
  assert.equal(localDraft.total.value, 1545.06);
  assert.equal(localDraft.lines[0].partNumber.value, "240VBW289714N");
  assert.equal(localDraft.lines[0].quantity.value, null);
  assert.equal(localTemplateDraftIsUsable(localDraft), false);

  next.regions.push(region("5", 100, 565, 40, 24));
  const nextReviewed = reviewedDraft();
  nextReviewed.invoiceNumber.value = "XC240109219:01";
  nextReviewed.total.value = 1545.06;
  const learnedWithQuantity = learnInvoiceTemplateCandidate({ observation: next, reviewedDraft: nextReviewed });
  const completeDraft = buildInvoiceDraftFromTemplate({ observation: next, template: learnedWithQuantity });
  assert.equal(completeDraft.lines[0].quantity.value, 5);
  assert.equal(localTemplateDraftIsUsable(completeDraft), true);
});

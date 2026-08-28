import assert from "node:assert/strict";
import test from "node:test";
import { reconcileInvoiceDrafts } from "./invoice-draft-reconciliation.js";

function field(value, confidence = 70, evidence = "candidate evidence") {
  return { value, confidence, evidence };
}

function line(id, overrides = {}) {
  return {
    id,
    partNumber: field("LF-9009"),
    description: field("Oil filter"),
    quantity: field(2),
    unitOfMeasure: field("ea"),
    unitPrice: field(10),
    lineTotal: field(20),
    ...overrides,
  };
}

function draft(overrides = {}) {
  return {
    documentType: field("invoice"),
    vendorName: field("Fleet Pride"),
    vendorAccount: field("A-1"),
    invoiceNumber: field("INV-10"),
    invoiceDate: field("2026-08-24"),
    purchaseOrderNumber: field("PO-9"),
    currency: field("USD"),
    subtotal: field(20),
    tax: field(0),
    shipping: field(0),
    total: field(20),
    lines: [line("primary-line-1")],
    warnings: [],
    ...overrides,
  };
}

test("agreement records corroboration without boosting correlated confidence", () => {
  const result = reconcileInvoiceDrafts({
    primaryDraft: draft({ vendorName: field("Fleet Pride", 72, "OpenAI header") }),
    localDraft: draft({ vendorName: field("fleet   pride", 88, "OCR header") }),
  });

  assert.equal(result.vendorName.value, "Fleet Pride");
  assert.equal(result.vendorName.confidence, 72);
  assert.match(result.vendorName.evidence, /Agreed with local OCR/);
  assert.deepEqual(result.warnings, []);
});

test("zero-confidence local candidates do not boost or conflict with primary truth", () => {
  const result = reconcileInvoiceDrafts({
    primaryDraft: draft({ invoiceNumber: field("INV-10", 94, "OpenAI header") }),
    localDraft: draft({ invoiceNumber: field("INV-70", 0, "Untrusted OCR guess") }),
  });

  assert.equal(result.invoiceNumber.value, "INV-10");
  assert.equal(result.invoiceNumber.confidence, 94);
  assert.deepEqual(result.warnings, []);
});

test("conflicts deterministically preserve primary values below the review threshold", () => {
  const result = reconcileInvoiceDrafts({
    primaryDraft: draft({ invoiceNumber: field("INV-10", 98, "OpenAI invoice number") }),
    localDraft: draft({ invoiceNumber: field("INV-70", 99, "OCR invoice number") }),
  });

  assert.equal(result.invoiceNumber.value, "INV-10");
  assert.equal(result.invoiceNumber.confidence, 89);
  assert.match(result.warnings[0], /Invoice number differs between OpenAI extraction and local OCR/);
});

test("meaningful local values fill missing primary fields but remain reviewable", () => {
  const result = reconcileInvoiceDrafts({
    primaryDraft: draft({ vendorAccount: field("", 0, "Not found"), tax: field(null, 0, "Not found") }),
    localDraft: draft({ vendorAccount: field("ACCT-42", 97, "OCR account"), tax: field(0, 96, "Printed tax") }),
  });

  assert.deepEqual(
    { value: result.vendorAccount.value, confidence: result.vendorAccount.confidence },
    { value: "ACCT-42", confidence: 89 },
  );
  assert.deepEqual({ value: result.tax.value, confidence: result.tax.confidence }, { value: 0, confidence: 89 });
  assert.ok(result.warnings.some((warning) => /Vendor account was missing.*review required/i.test(warning)));
  assert.ok(result.warnings.some((warning) => /Tax was missing.*review required/i.test(warning)));
});

test("lines match by normalized part number before index and keep primary IDs and order", () => {
  const primary = draft({
    lines: [
      line("primary-a", { partNumber: field("LF-9009"), description: field("", 0) }),
      line("primary-b", { partNumber: field("AB 12"), unitPrice: field(null, 0) }),
    ],
  });
  const local = draft({
    lines: [
      line("local-b", { partNumber: field("AB-12"), description: field("Air filter"), unitPrice: field(14) }),
      line("local-a", { partNumber: field("LF9009"), description: field("Oil filter element"), unitPrice: field(10) }),
    ],
    warnings: [
      "Local OCR bootstrap extraction; review required before learning or inventory use.",
      "Invoice number was not confidently detected.",
    ],
  });

  const result = reconcileInvoiceDrafts({ primaryDraft: primary, localDraft: local });

  assert.deepEqual(result.lines.map((item) => item.id), ["primary-a", "primary-b"]);
  assert.equal(result.lines[0].description.value, "Oil filter element");
  assert.equal(result.lines[1].unitPrice.value, 14);
  assert.equal(result.warnings.some((warning) => /Local OCR bootstrap|not confidently detected/.test(warning)), false);
});

test("equal line counts never authorize positional cross-row fills", () => {
  const primary = draft({
    lines: [
      line("primary-a", { partNumber: field("", 0), description: field("Air filter") }),
      line("primary-b", { partNumber: field("", 0), description: field("Oil filter") }),
    ],
  });
  const local = draft({
    lines: [
      line("local-b", { partNumber: field("OIL-2"), description: field("Oil filter") }),
      line("local-a", { partNumber: field("AIR-1"), description: field("Air filter") }),
    ],
  });

  const result = reconcileInvoiceDrafts({ primaryDraft: primary, localDraft: local });
  assert.deepEqual(result.lines.map((item) => item.partNumber.value), ["", ""]);
  assert.deepEqual(result.lines.map((item) => item.description.value), ["Air filter", "Oil filter"]);
});

test("local OCR lines fill an empty primary line table but stay below automatic approval confidence", () => {
  const result = reconcileInvoiceDrafts({
    primaryDraft: draft({ lines: [] }),
    localDraft: draft({ lines: [line("local-private-id", { partNumber: field("ZX-1", 97) })] }),
  });

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].id, "line-1");
  assert.equal(result.lines[0].partNumber.value, "ZX-1");
  assert.equal(result.lines[0].partNumber.confidence, 89);
  assert.ok(result.warnings.some((warning) => /found no invoice lines/i.test(warning)));
});

test("reconciliation does not mutate either candidate", () => {
  const primary = draft({ vendorName: field("Primary", 95) });
  const local = draft({ vendorName: field("Local", 95) });
  const primarySnapshot = structuredClone(primary);
  const localSnapshot = structuredClone(local);

  reconcileInvoiceDrafts({ primaryDraft: primary, localDraft: local });

  assert.deepEqual(primary, primarySnapshot);
  assert.deepEqual(local, localSnapshot);
});

test("paid zero candidates conflict with a positive total while null never overwrites it", () => {
  const paid = reconcileInvoiceDrafts({
    primaryDraft: draft({ subtotal: field(1470), total: field(1470, 98) }),
    localDraft: draft({ subtotal: field(1470), total: field(0, 99) }),
  });
  const missing = reconcileInvoiceDrafts({
    primaryDraft: draft({ total: field(1470, 98) }),
    localDraft: draft({ total: field(null, 0) }),
  });

  assert.equal(paid.total.value, 1470);
  assert.equal(paid.total.confidence, 89);
  assert.match(paid.warnings[0], /Invoice total differs/);
  assert.equal(missing.total.value, 1470);
  assert.equal(missing.total.confidence, 98);
});

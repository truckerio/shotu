import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./CommercialProfileSettings.jsx", import.meta.url), "utf8");

test("commercial profile reads scoped state and publishes immutable versions", () => {
  assert.match(source, /\/api\/customer-documents\/profile\?\$\{params\}/);
  assert.match(source, /\/api\/admin\/customer-document-profiles/);
  assert.match(source, /expectedVersion: draft\.expectedVersion/);
  assert.match(source, /taxProfileVersionId: draft\.taxProfileVersionId\.trim\(\)/);
  assert.match(source, /lineTaxPolicy: draft\.lineTaxPolicy/);
  assert.match(source, /documentNumbering: \{ estimate: \{ prefix: draft\.estimatePrefix\.trim\(\), digits: Number\(draft\.estimateDigits\) \}, invoice: \{ prefix: draft\.invoicePrefix\.trim\(\), digits: Number\(draft\.invoiceDigits\) \} \}/);
  assert.match(source, /estimateValidityDays: draft\.estimateValidityDays \? Number\(draft\.estimateValidityDays\) : null/);
});

test("commercial profile fails closed without required configuration", () => {
  assert.match(source, /TAX_TYPES\.some\(\(\[key\]\) => !draft\.lineTaxPolicy\[key\]\)/);
  assert.match(source, /Unconfigured — choose before publishing/);
  assert.match(source, /disabled=\{missing \|\| state === "loading" \|\| state === "saving"\}/);
});

test("commercial profile round-trips immutable fields instead of clearing an existing version", () => {
  for (const field of ["registrationIdentifiers", "logoUrl", "accentColor", "warrantyTerms", "footerTerms", "maxOfficePercentage", "lineTaxPolicy", "documentNumbering", "estimateValidityDays"]) {
    assert.match(source, new RegExp(`${field}`));
  }
  assert.match(source, /registrationIdentifiers: draft\.registrationIdentifiers/);
  assert.match(source, /documentTerms: \{ estimate: draft\.estimateTerms, invoice: draft\.invoiceTerms, warranty: draft\.warrantyTerms, footer: draft\.footerTerms \}/);
  assert.match(source, /discountPolicy: \{ maxOfficePercentage: draft\.maxOfficePercentage\.trim\(\), reasonRequired: true \}/);
  assert.match(source, /\^\(\?:0\|\[1-9\]\\d\?\|100\)/);
});

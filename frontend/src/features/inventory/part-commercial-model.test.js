import assert from "node:assert/strict";
import test from "node:test";
import { archiveCommand, archivePayload, configuredPriceView, displayMoney, effectiveSellingPrice, eligibleProfiles, locationPriceEditState, previewPayload, pricePayload, priceSourceLabel, profilePayload, purchaseCoverageLabel, readablePreviewBlockers, receiptCostBasisLabel, receiptDateBasisLabel } from "./part-commercial-model.js";

test("configured prices distinguish explicit zero from Unknown", () => {
  assert.notEqual(configuredPriceView({ status: "known", amount: "0.0000", currency: "USD", version: 1 }).label, "Unknown");
  assert.equal(configuredPriceView({ status: "unknown", amount: null, currency: null, version: 2 }).label, "Unknown");
  assert.equal(displayMoney(null, "USD"), "Unknown");
});

test("header selling price follows company and effective location pricing", () => {
  const company = { prices: { selling: { current: { amount: "84.50", currency: "USD", status: "known" } } } };
  const location = { prices: { selling: { effective: { amount: "91.25", currency: "USD", status: "known" }, companyDefault: company.prices.selling } } };
  assert.equal(effectiveSellingPrice(company)?.amount, "84.50");
  assert.equal(effectiveSellingPrice(location, true)?.amount, "91.25");
  assert.equal(effectiveSellingPrice({ prices: {} }), null);
});

test("clearing a price sends paired null values and preserves optimistic version", () => {
  assert.deepEqual(pricePayload({ amount: "", currency: "USD", taxTreatment: "inclusive", taxProfileVersionId: "tax-1", reason: "Clear old price", expectedVersion: 4, idempotencyKey: "request-123" }), {
    expectedVersion: 4, amount: null, currency: null, taxTreatment: "not_configured", taxProfileVersionId: null, reason: "Clear old price", idempotencyKey: "request-123",
  });
});

test("coverage always calls missing purchase cost out", () => {
  assert.equal(purchaseCoverageLabel({ coverage: { knownQuantity: 2, unknownQuantity: 3 } }), "2 known · 3 missing cost");
  assert.equal(purchaseCoverageLabel({ coverage: { knownQuantity: 0, unknownQuantity: 0 } }), "No purchase cost recorded");
});

test("location editing uses the override version while showing the effective fallback", () => {
  const fallback = { id: "default", version: 8, amount: "12", currency: "USD", status: "known" };
  assert.deepEqual(locationPriceEditState({ effective: fallback, source: "company_default", override: { current: null }, companyDefault: { current: fallback } }), {
    draft: fallback, expectedVersion: 0, effective: fallback, override: null, companyDefault: fallback, source: "company_default",
  });
  const masked = { id: "override", version: 2, amount: null, currency: null, status: "unknown" };
  assert.equal(locationPriceEditState({ effective: masked, source: "location_override", override: { current: masked }, companyDefault: { current: fallback } }).expectedVersion, 2);
  assert.equal(configuredPriceView(masked).label, "Unknown");
});

test("commercial labels preserve price source and receipt evidence truth", () => {
  assert.equal(priceSourceLabel("location_override"), "Location override");
  assert.equal(priceSourceLabel("company_default"), "Company default");
  assert.equal(receiptCostBasisLabel({ basis: "source_invoice_line_missing_cost" }), "Invoice line · cost missing");
  assert.equal(receiptCostBasisLabel({ basis: "unpriced_receipt" }), "Receipt · cost missing");
  assert.equal(receiptDateBasisLabel({ dateBasis: "invoice_date" }), "Invoice date");
});

test("a taxable price keeps only the exact selected tax profile version", () => {
  const payload = pricePayload({ amount: "17.25", currency: "cad", taxTreatment: "exclusive", taxProfileVersionId: "version-8", reason: "Counter retail", expectedVersion: 3, idempotencyKey: "price-8" });
  assert.equal(payload.currency, "CAD");
  assert.equal(payload.taxProfileVersionId, "version-8");
  assert.equal(pricePayload({ ...payload, taxTreatment: "exempt" }).taxProfileVersionId, null);
});

test("profile selection cannot cross currency or use archived profiles", () => {
  const profiles = [{ archived: false, current: { currency: "USD" } }, { archived: true, current: { currency: "USD" } }, { archived: false, current: { currency: "CAD" } }];
  assert.deepEqual(eligibleProfiles(profiles, "usd"), [profiles[0]]);
});

test("profile and preview payloads keep decimal values as strings", () => {
  const create = profilePayload({ companyId: "co", name: "WA", currency: "usd", jurisdiction: "Washington", components: [{ name: "State", rate: "6.5", compound: false }], reason: "Initial", expectedVersion: null, idempotencyKey: "profile-1" });
  assert.deepEqual(create, { companyId: "co", name: "WA", currency: "USD", jurisdiction: "Washington", components: [{ name: "State", rate: "6.5", compound: false }], reason: "Initial", idempotencyKey: "profile-1" });
  const revise = profilePayload({ companyId: "co", name: "WA", currency: "usd", jurisdiction: "Washington", components: [{ name: "State", rate: "6.5", compound: false }], reason: "Correct rate", expectedVersion: 3, idempotencyKey: "profile-2" });
  assert.deepEqual(revise, { name: "WA", currency: "USD", jurisdiction: "Washington", components: [{ name: "State", rate: "6.5", compound: false }], reason: "Correct rate", expectedVersion: 3, idempotencyKey: "profile-2" });
  assert.deepEqual(previewPayload({ priceKind: "selling", quantity: "2.5", discountPercent: "10", draft: { amount: "4.00", currency: "usd", taxTreatment: "inclusive", taxProfileVersionId: "version-1" } }), { priceKind: "selling", quantity: "2.5", discountPercent: "10", draft: { amount: "4.00", currency: "USD", taxTreatment: "inclusive", taxProfileVersionId: "version-1" } });
});

test("large API decimal totals never pass through Number formatting", () => {
  assert.equal(displayMoney("12345678901234567890.1234", "USD"), "USD 12,345,678,901,234,567,890.1234");
  assert.equal(displayMoney("999999999999.9999", "USD"), "USD 999,999,999,999.9999");
  assert.equal(displayMoney("123", "JPY").includes(".00"), false);
  assert.match(displayMoney("1.234", "KWD"), /1\.234/);
  assert.match(displayMoney("1", "USD"), /1\.00/);
});

test("archive retries reuse a command only while every command fact matches", () => {
  const first = archiveCommand(null, { profileId: "profile-1", expectedVersion: 3, reason: "Replaced", idempotencyKey: "archive-1" });
  assert.strictEqual(archiveCommand(first, { profileId: "profile-1", expectedVersion: 3, reason: "Replaced", idempotencyKey: "archive-2" }), first);
  assert.equal(archiveCommand(first, { profileId: "profile-1", expectedVersion: 3, reason: "Different reason", idempotencyKey: "archive-2" }).idempotencyKey, "archive-2");
  assert.deepEqual(archivePayload(first), { expectedVersion: 3, archived: true, reason: "Replaced", idempotencyKey: "archive-1" });
});

test("an intentionally cleared draft is sent as unknown and blockers are readable", () => {
  assert.deepEqual(previewPayload({ priceKind: "selling", quantity: "1", discountPercent: "0", draft: { amount: "", currency: "", taxTreatment: "not_configured", taxProfileVersionId: "" } }).draft, { amount: null, currency: null, taxTreatment: "not_configured", taxProfileVersionId: null });
  assert.deepEqual(readablePreviewBlockers(["tax_profile_required", "unexpected_code"]), ["Select a tax profile for this taxable price.", "This price cannot be checked until its missing configuration is resolved."]);
});

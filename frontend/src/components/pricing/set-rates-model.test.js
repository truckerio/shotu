import assert from "node:assert/strict";
import test from "node:test";
import { availableRateKinds, editablePartRateKinds, notifyRateSaved, partRatePaths, rateDraft, rateDraftIsValid, rateSourceLabel, retryCommand, sellingRateDraft } from "./set-rates-model.js";

test("rate kinds preserve the shared dialog order and permissions", () => {
  assert.deepEqual(availableRateKinds(), ["internal_cost", "selling_price"]);
  assert.deepEqual(availableRateKinds(["selling_price"]), ["selling_price"]);
});

test("rate drafts preserve selling methods and allow an audited internal clear", () => {
  assert.deepEqual(rateDraft({ selling_price: { amount: "18", currency: null, method: "markup_percent" } }, "selling_price"), { amount: "18", currency: "USD", method: "markup_percent" });
  assert.equal(rateDraftIsValid({ kind: "internal_cost", amount: "", currency: "USD", reason: "Clear obsolete cost", method: "fixed" }), true);
  assert.equal(rateDraftIsValid({ kind: "selling_price", amount: "", currency: "USD", reason: "Missing price", method: "fixed" }), false);
  assert.equal(rateDraftIsValid({ kind: "selling_price", amount: "12.5", currency: "", reason: "New markup", method: "markup_percent" }), true);
});

test("no-stock items cannot carry an inherited markup into a fixed-price save", () => {
  assert.deepEqual(sellingRateDraft({ method: "markup_percent", value: "20", currency: null }, "no_stock", "CAD"), { amount: "", currency: "CAD", method: "fixed" });
  assert.deepEqual(sellingRateDraft({ method: "markup_amount", value: "5", currency: "USD" }, "quantity", "CAD"), { amount: "5", currency: "USD", method: "markup_amount" });
});

test("scope labels distinguish location overrides from company fallback", () => {
  assert.equal(rateSourceLabel("location_override", true), "Location override");
  assert.equal(rateSourceLabel("company_default", true), "Company fallback");
  assert.equal(rateSourceLabel("company_default", false), "Company default");
});

test("part rate permissions prevent read-only and unprivileged company writes", () => {
  assert.deepEqual(editablePartRateKinds({ readOnly: true, commercialCapabilities: { canEditPrices: true }, sellingCapabilities: { canEdit: true } }), []);
  assert.deepEqual(editablePartRateKinds({ readOnly: false, commercialCapabilities: { canEditPrices: false }, sellingCapabilities: { canEdit: false } }), []);
  assert.deepEqual(editablePartRateKinds({ readOnly: false, commercialCapabilities: { canEditPrices: true }, sellingCapabilities: { canEdit: false } }), ["internal_cost"]);
});

test("part rate paths retain exact company and location scope", () => {
  const company = partRatePaths("part/id", null);
  assert.equal(company.internal, "/api/office/inventory/parts/part%2Fid/prices/internal");
  assert.equal(company.selling, "/api/office/inventory/parts/part%2Fid/selling-policy");
  const location = partRatePaths("part/id", "loc/id");
  assert.equal(location.internal, "/api/office/inventory/parts/part%2Fid/locations/loc%2Fid/prices/internal");
  assert.match(location.commercial, /locationId=loc%2Fid/);
  assert.equal(location.selling, "/api/office/inventory/parts/part%2Fid/selling-policy?locationId=loc%2Fid");
});

test("failed command retries reuse the key until command facts change", () => {
  let calls = 0;
  const createKey = () => `key-${++calls}`;
  const first = retryCommand(null, "same", createKey);
  assert.equal(retryCommand(first, "same", createKey), first);
  assert.deepEqual(retryCommand(first, "changed", createKey), { signature: "changed", key: "key-2" });
});

test("a failed consumer refresh cannot turn a successful write into a retry", async () => {
  assert.equal(await notifyRateSaved(async () => { throw new Error("refresh failed"); }), false);
  assert.equal(await notifyRateSaved(async () => {}), true);
});

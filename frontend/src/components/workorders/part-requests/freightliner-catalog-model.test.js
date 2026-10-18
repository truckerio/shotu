import assert from "node:assert/strict";
import test from "node:test";
import {
  FREIGHTLINER_CATALOG_URL,
  freightlinerAssetContext,
  freightlinerRequestContextKey,
  isFreightlinerAsset,
  validFreightlinerVin,
} from "./freightliner-catalog-model.js";

test("only an explicit Freightliner make enables the reference", () => {
  assert.equal(isFreightlinerAsset({ make: " Freightliner " }), true);
  assert.equal(isFreightlinerAsset({ make: "Freightliner Cascadia" }), false);
  assert.equal(isFreightlinerAsset({ model: "Cascadia" }), false);
  assert.equal(isFreightlinerAsset({ make: "Ford" }), false);
});

test("uses current asset context with workorder fallbacks and resets when truck identity changes", () => {
  const first = { id: "wo-1", asset: { id: "truck-1", make: "Freightliner", unitNo: "G2116" }, formData: { vinNo: "1FUJGLDR8BSAX1234", model: "Cascadia" } };
  assert.deepEqual(freightlinerAssetContext(first), {
    id: "truck-1", make: "Freightliner", model: "Cascadia", unitNo: "G2116", vin: "1FUJGLDR8BSAX1234",
  });
  assert.notEqual(freightlinerRequestContextKey(first), freightlinerRequestContextKey({ ...first, id: "wo-2" }));
  assert.notEqual(freightlinerRequestContextKey(first), freightlinerRequestContextKey({ ...first, asset: { ...first.asset, id: "truck-2" } }));
  assert.notEqual(freightlinerRequestContextKey(first), freightlinerRequestContextKey({ ...first, formData: { ...first.formData, vinNo: "1FUJGLDR9BSAX5678" } }));
});

test("VIN copy eligibility checks the ninth digit and permitted characters", () => {
  assert.equal(validFreightlinerVin("1FUJGLDR8BSAX1234"), true);
  assert.equal(validFreightlinerVin("1fujgldr8bsax1234"), true);
  assert.equal(validFreightlinerVin("1FUJGLDRXBSAX1235"), true);
  assert.equal(validFreightlinerVin("1FUJGLDR9BSAX1234"), false);
  assert.equal(validFreightlinerVin("1FUJGLDRYBSAX1234"), false);
  assert.equal(validFreightlinerVin("AAAAAAAAAAAAAAAAA"), false);
  assert.equal(validFreightlinerVin("1FUJGLDR9BSAX123"), false);
  assert.equal(validFreightlinerVin("1FUJGLDR9BSAXI234"), false);
  assert.equal(validFreightlinerVin(""), false);
  assert.equal(FREIGHTLINER_CATALOG_URL, "https://www.dtnaparts.com/excelerator/");
});

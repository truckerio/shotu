import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogInventoryText,
  catalogPartDetails,
  normalizeCatalogResponse,
  repairOrderAfterCatalogSelection,
} from "./catalog-parts-model.js";

test("normalizes catalog and location inventory without leaking API shape", () => {
  const result = normalizeCatalogResponse({
    catalogAvailable: true,
    items: [{
      catalogPartId: "part-1",
      normalizedPartNumber: "LF14000NN",
      name: "Oil filter",
      unit: "EA",
      inventory: [{ id: "zero", quantityAvailable: 0 }, {
        id: "stock-1",
        locationId: "chino",
        locationName: "Chino",
        quantityAvailable: "6",
        bin: "A-12",
      }],
    }],
  });

  assert.equal(result.items[0].id, "part-1");
  assert.equal(result.items[0].partNumber, "LF14000NN");
  assert.equal(result.items[0].inventory.itemId, "stock-1");
  assert.equal(result.items[0].inventory.available, 6);
  assert.equal(catalogInventoryText(result.items[0]), "6 pc available at Chino · Bin A-12");
});

test("distinguishes an empty company catalog from a query with no matches", () => {
  assert.deepEqual(normalizeCatalogResponse({ catalogAvailable: false, items: [] }), {
    catalogAvailable: false,
    items: [],
  });
  assert.deepEqual(normalizeCatalogResponse({ catalogAvailable: true, items: [] }), {
    catalogAvailable: true,
    items: [],
  });
});

test("catalog description fills only a blank repair order", () => {
  const catalogPart = { description: "  Oil filter, full-flow spin-on  " };

  assert.equal(repairOrderAfterCatalogSelection("", catalogPart), "Oil filter, full-flow spin-on");
  assert.equal(repairOrderAfterCatalogSelection("Install and inspect for leaks", catalogPart), "Install and inspect for leaks");
  assert.equal(repairOrderAfterCatalogSelection("", {}), "");
});

test("catalog description autofill respects the used-parts payload limit", () => {
  assert.equal(repairOrderAfterCatalogSelection("", { description: "x".repeat(2100) }).length, 2000);
});

test("master matching uses a neutral catalog fallback instead of operational stock wording", () => {
  const text = (key) => ({
    "parts.ourInventoryPart": "Our inventory part",
    "parts.masterCatalogPart": "Master catalog part",
  })[key];
  assert.equal(catalogPartDetails({}, text), "Our inventory part");
  assert.equal(catalogPartDetails({}, text, "master_match"), "Master catalog part");
});

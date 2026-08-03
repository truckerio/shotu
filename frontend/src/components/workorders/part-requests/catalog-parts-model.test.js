import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogInventoryText,
  normalizeCatalogResponse,
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

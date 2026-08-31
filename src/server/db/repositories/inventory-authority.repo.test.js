import test from "node:test";
import assert from "node:assert/strict";
import {
  inspectInventoryAuthority,
  recordInventoryAuthorityCutover,
} from "./inventory-authority.repo.js";

const input = {
  companyId: "company",
  locationId: "location",
  catalogPartId: "catalog-a",
  normalizedPartNumber: "PART1",
  uomCode: "ea",
};

test("authority inspection exposes identity-matched UOM drift as unmatched", async () => {
  const calls = [];
  const client = {
    query: async (sql) => {
      calls.push(sql);
      if (sql.includes("from inventory_items")) return { rows: [] };
      return { rows: [{ id: "balance", catalog_part_id: "catalog-a", uom_code: "gal", quantity_on_hand: 4 }] };
    },
  };
  const result = await inspectInventoryAuthority(client, input);
  assert.equal(result.kind, "unmatched_identity");
  assert.equal(result.source.sourceKind, "odoo_balance");
  assert.equal(calls.every((sql) => !sql.includes("uom_code = $5")), true);
});

test("cutover snapshots every duplicate legacy and provider-balance source", async () => {
  const calls = [];
  const client = { query: async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; } };
  const legacy = { id: "legacy", catalog_part_id: "catalog-a", uom_code: "ea", source_provider: "provider", external_id: "old", quantity_on_hand: 3, quantity_reserved: 0 };
  const balance = { id: "balance", catalog_part_id: "catalog-a", uom_code: "ea", external_id: "projection", quantity_on_hand: 7 };
  await recordInventoryAuthorityCutover(client, {
    claim: { kind: "claimable", sources: [
      { sourceKind: "legacy_inventory_item", row: legacy },
      { sourceKind: "odoo_balance", row: balance },
    ] },
    companyId: "company", locationId: "location", catalogPartId: "catalog-a",
    receiptId: "receipt", receiptLineId: "line",
  });
  const inserts = calls.filter(({ sql }) => sql.includes("insert into inventory_authority_cutovers"));
  assert.equal(inserts.length, 2);
  assert.deepEqual(inserts.map(({ values }) => values[12]), ["legacy_inventory_item", "odoo_balance"]);
});

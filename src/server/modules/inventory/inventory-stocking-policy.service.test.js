import assert from "node:assert/strict";
import test from "node:test";
import { updateInventoryStockRule } from "./inventory-stocking-policy.service.js";

const PART = "00000000-0000-4000-8000-000000000701";
const LOCATION = "00000000-0000-4000-8000-000000000702";
const COMPANY = "00000000-0000-4000-8000-000000000703";
const ACTOR = "00000000-0000-4000-8000-000000000704";
const context = (role = "office") => ({ actor: { id: ACTOR, role }, companyIds: new Set([COMPANY]), locationIds: new Set([LOCATION]) });

test("Office saves a scoped minimum and optional target without ordering inventory", async () => {
  let saved;
  const result = await updateInventoryStockRule(PART, { locationId: LOCATION, minimumAvailable: 5, targetQuantity: 12, alertEnabled: true }, context(), {
    save: async (input) => { saved = input; return { kind: "saved" }; },
  });
  assert.equal(result.kind, "saved");
  assert.equal(saved.catalogPartId, PART);
  assert.deepEqual(saved.companyIds, [COMPANY]);
  assert.deepEqual(saved.locationIds, [LOCATION]);
  assert.equal(saved.minimumAvailable, 5);
  assert.equal(saved.targetQuantity, 12);
});

test("stock rules reject bad targets, stale versions, and mechanic access", async () => {
  await assert.rejects(updateInventoryStockRule(PART, { locationId: LOCATION, minimumAvailable: 5, targetQuantity: 4 }, context(), { save: async () => assert.fail() }));
  await assert.rejects(updateInventoryStockRule(PART, { locationId: LOCATION, minimumAvailable: 5 }, context("mechanic"), { save: async () => assert.fail() }), (error) => error.statusCode === 403);
  await assert.rejects(updateInventoryStockRule(PART, { locationId: LOCATION, minimumAvailable: 5 }, context(), { save: async () => ({ kind: "stale" }) }), (error) => error.statusCode === 409);
});

test("stocking migration deduplicates open alerts and reevaluates every balance change", async () => {
  const { readFile } = await import("node:fs/promises");
  const sql = await readFile(new URL("../../db/migrations/128_inventory_stocking_policy_alerts.sql", import.meta.url), "utf8");
  assert.match(sql, /where resolved_at is null/i);
  assert.match(sql, /on conflict \(company_id,location_id,catalog_part_id\) where resolved_at is null/i);
  assert.match(sql, /after insert or update of quantity_on_hand, quantity_reserved/i);
  assert.match(sql, /greatest\(new\.quantity_on_hand-new\.quantity_reserved, 0\)/i);
  assert.match(sql, /target_quantity is null or target_quantity >= minimum_available/i);
});

test("a catalog-only part is evaluated as zero available when its first stock rule is saved", async () => {
  const { readFile } = await import("node:fs/promises");
  const repository = await readFile(new URL("../../db/repositories/inventory-stocking-policy.repo.js", import.meta.url), "utf8");
  assert.match(repository, /const available = balance\.rows\[0\][\s\S]*?: 0;/);
  assert.match(repository, /else await client\.query\(`insert into inventory_replenishment_alerts/);
  assert.doesNotMatch(repository, /if \(balance\.rows\[0\]\)/);
});

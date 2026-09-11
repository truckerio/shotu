import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAggregateStockIntake } from "./inventory-stock-intake.service.js";

const COMPANY_ID = "00000000-0000-4000-8000-000000000101";
const LOCATION_ID = "00000000-0000-4000-8000-000000000102";
const PART_ID = "00000000-0000-4000-8000-000000000103";
const ACTOR_ID = "00000000-0000-4000-8000-000000000104";
const context = (role = "office") => ({ actor: { id: ACTOR_ID, role }, companyIds: new Set([COMPANY_ID]), locationIds: new Set([LOCATION_ID]) });
const input = { quantity: 3, uomCode: "ea", trackingMode: "quantity", confirmation: "physically_present_at_location", idempotencyKey: "manual-intake-101" };

test("aggregate intake forwards scoped physical evidence and returns replay state", async () => {
  let command;
  const result = await createAggregateStockIntake(PART_ID, LOCATION_ID, input, context(), {
    postIntake: async (value) => { command = value; return { kind: "posted", receiptId: "receipt-1", quantity: 3 }; },
  });
  assert.deepEqual(command.companyIds, [COMPANY_ID]);
  assert.deepEqual(command.locationIds, [LOCATION_ID]);
  assert.equal(command.actorId, ACTOR_ID);
  assert.equal(result.replayed, false);
});

test("aggregate intake blocks mechanics and stale tracking policy", async () => {
  await assert.rejects(createAggregateStockIntake(PART_ID, LOCATION_ID, input, context("mechanic"), {
    postIntake: async () => assert.fail("mechanic reached repository"),
  }), (error) => error.code === "INVENTORY_CREATE_FORBIDDEN" && error.statusCode === 403);
  await assert.rejects(createAggregateStockIntake(PART_ID, LOCATION_ID, input, context(), {
    postIntake: async () => ({ kind: "tracking_policy" }),
  }), (error) => error.code === "INVENTORY_INTAKE_TRACKING_POLICY" && error.statusCode === 409);
});

test("aggregate intake schema limits precision and canonical policy values", async () => {
  let accepted;
  await createAggregateStockIntake(PART_ID, LOCATION_ID, { ...input, quantity: 1.005, uomCode: "gal", trackingMode: "measured_bulk" }, context(), {
    postIntake: async (value) => { accepted = value; return { kind: "posted", receiptId: "receipt-1005", quantity: value.quantity }; },
  });
  assert.equal(accepted.quantity, 1.005);
  await assert.rejects(createAggregateStockIntake(PART_ID, LOCATION_ID, { ...input, quantity: 1.0001 }, context(), {
    postIntake: async () => assert.fail("invalid quantity reached repository"),
  }));
  await assert.rejects(createAggregateStockIntake(PART_ID, LOCATION_ID, { ...input, trackingMode: "serialized" }, context(), {
    postIntake: async () => assert.fail("serialized request reached aggregate repository"),
  }));
});

test("revoked location cannot replay a prior intake", async () => {
  let called = false;
  const revoked = { ...context(), locationIds: new Set() };
  await assert.rejects(createAggregateStockIntake(PART_ID, LOCATION_ID, input, revoked, {
    postIntake: async () => { called = true; return { kind: "replay", receiptId: "hidden-receipt", quantity: 3 }; },
  }), (error) => error.code === "inventory_not_found" && error.statusCode === 404);
  assert.equal(called, false);
});

test("manual intake migration creates one receipt source and canonical append-only movement", async () => {
  const sql = await readFile(new URL("../../db/migrations/130_inventory_manual_stock_intake.sql", import.meta.url), "utf8");
  const source = await readFile(new URL("../../db/repositories/inventory-stock-intake.repo.js", import.meta.url), "utf8");
  assert.match(sql, /create table inventory_manual_intake_batches/i);
  assert.match(sql, /provider='local_manual'/i);
  assert.match(sql, /alter column quantity type numeric\(14,3\)/i);
  assert.match(sql, /quantity > 0 and quantity <= 999999\.999/i);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /batch\.location_id=any\(\$4::uuid\[\]\)/);
  assert.match(source, /insert into inventory_receipt_lines/);
  assert.match(source, /'manual_receipt'/);
  assert.match(source, /quantity_on_hand=inventory_items\.quantity_on_hand\+excluded\.quantity_on_hand/);
  assert.match(source, /recordInventoryAuthorityCutover/);
});

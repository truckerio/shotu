import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createPartFulfillmentSchema } from "./part-fulfillment.schemas.js";
const sql = readFileSync(new URL("../../db/migrations/067_part_fulfillment.sql", import.meta.url), "utf8");
test("fulfillment migration has scoped durable requests, legs, events, and bounded indexes", () => {
  for (const table of ["part_fulfillment_requests", "part_fulfillment_legs", "part_fulfillment_events"]) assert.match(sql, new RegExp(`create table ${table}`, "i"));
  assert.match(sql, /unique \(company_id, created_by_user_id, idempotency_key\)/i);
  assert.match(sql, /part_fulfillment_leg_route_shape/i);
  assert.match(sql, /part_fulfillment_requests_destination_state_idx/i);
  assert.match(sql, /ready_for_transfer/);
});
test("fulfillment request validates quantity and normalized inputs", () => {
  const good = { workorderId: "11111111-1111-4111-8111-111111111111", catalogPartId: "22222222-2222-4222-8222-222222222222", destinationLocationId: "33333333-3333-4333-8333-333333333333", quantity: 1, uomCode: "ea", idempotencyKey: "abcdefgh" };
  assert.equal(createPartFulfillmentSchema.safeParse(good).success, true);
  assert.equal(createPartFulfillmentSchema.safeParse({ ...good, quantity: 0 }).success, false);
});

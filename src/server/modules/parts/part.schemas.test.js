import assert from "node:assert/strict";
import test from "node:test";
import { createPartRequestSchema, decidePartRequestSchema } from "./part.schemas.js";

function decision(overrides = {}) {
  return {
    decision: "approved",
    partNumber: "LF9009",
    manufacturer: "Fleetguard",
    description: "Engine oil filter",
    category: "lube_filter",
    quantity: 1,
    repairOrder: "Replace engine oil filter.",
    fitmentStatus: "confirmed",
    fitmentNotes: "",
    reason: "",
    allocations: [{
      sourceType: "inventory",
      status: "reserved",
      quantity: 1,
      locationId: null,
      inventoryItemId: null,
      vendor: "",
      sourceReference: "",
      unitPrice: null,
      quoteUrl: "",
    }],
    ...overrides,
  };
}

test("approved part decisions require an identified part and complete supply", () => {
  assert.equal(decidePartRequestSchema.safeParse(decision()).success, true);
  assert.equal(decidePartRequestSchema.safeParse(decision({
    partNumber: "",
    description: "",
  })).success, false);
  assert.equal(decidePartRequestSchema.safeParse(decision({
    quantity: 2,
  })).success, false);
  assert.equal(decidePartRequestSchema.safeParse(decision({
    fitmentStatus: "conflict",
  })).success, false);
});

test("questions and declines require feedback for the mechanic", () => {
  assert.equal(decidePartRequestSchema.safeParse(decision({
    decision: "needs_info",
    allocations: [],
    reason: "Send a photo of the existing filter.",
  })).success, true);
  assert.equal(decidePartRequestSchema.safeParse(decision({
    decision: "needs_info",
    allocations: [],
    reason: "",
  })).success, false);
  assert.equal(decidePartRequestSchema.safeParse(decision({
    decision: "rejected",
    allocations: [],
    reason: "Wrong application.",
  })).success, true);
});

test("part quantities support measured decimals and default legacy payloads to each", () => {
  assert.equal(createPartRequestSchema.parse({
    query: "Oil filter",
    quantity: 2,
  }).uomCode, "ea");

  assert.equal(createPartRequestSchema.parse({
    query: "Engine oil",
    quantity: 2.5,
    uomCode: "gal",
  }).quantity, 2.5);

  assert.equal(createPartRequestSchema.safeParse({
    query: "Oil filters",
    quantity: 2.5,
    uomCode: "ea",
  }).success, false);
});

test("approved allocations use the same unit as the request", () => {
  const result = decidePartRequestSchema.safeParse(decision({
    quantity: 2.5,
    uomCode: "gal",
    allocations: [{
      sourceType: "inventory",
      status: "reserved",
      quantity: 2.5,
      uomCode: "l",
    }],
  }));

  assert.equal(result.success, false);
});

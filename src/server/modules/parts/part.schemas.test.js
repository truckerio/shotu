import assert from "node:assert/strict";
import test from "node:test";
import { decidePartRequestSchema } from "./part.schemas.js";

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

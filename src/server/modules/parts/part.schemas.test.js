import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createOfficePartSchema, createPartRequestSchema, decidePartRequestSchema } from "./part.schemas.js";
import { PART_ALLOCATION_INITIAL_STATUSES } from "./part.constants.js";

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

test("part quantities support measured decimals and default legacy payloads to piece", () => {
  assert.equal(createPartRequestSchema.parse({
    query: "Oil filter",
    quantity: 2,
  }).uomCode, "pc");

  assert.equal(createPartRequestSchema.parse({
    query: "Engine oil",
    quantity: 2.5,
    uomCode: "gal",
  }).quantity, 2.5);

  assert.equal(createPartRequestSchema.safeParse({
    query: "Oil filters",
    quantity: 2.5,
    uomCode: "pc",
  }).success, false);
});

test("catalog selections retain immutable company catalog identity", () => {
  const catalogPartId = "11111111-1111-4111-8111-111111111111";
  const parsed = createPartRequestSchema.parse({
    catalogPartId,
    query: "LF9009",
    partNumber: "LF9009",
    quantity: 1,
  });

  assert.equal(parsed.catalogPartId, catalogPartId);
  assert.equal(createPartRequestSchema.safeParse({
    catalogPartId: "not-a-uuid",
    query: "LF9009",
    quantity: 1,
  }).success, false);
  assert.equal(decidePartRequestSchema.parse(decision({ catalogPartId })).catalogPartId, catalogPartId);
  assert.equal(decidePartRequestSchema.safeParse(decision({ catalogPartId: "not-a-uuid" })).success, false);
});

test("approval repository validates a newly selected catalog identity strictly", () => {
  const repository = readFileSync(new URL("../../db/repositories/part-requests.repo.js", import.meta.url), "utf8");
  assert.match(repository, /input\.catalogPartId \|\| request\.catalog_part_id/);
  assert.match(repository, /strict:\s*Boolean\(input\.catalogPartId\)/);
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

test("Office-created planned parts require explicit supply quantities to match", () => {
  const input = {
    query: "Oil filter",
    partNumber: "LF9009",
    quantity: 1,
    uomCode: "ea",
    allocations: [{ sourceType: "purchase", status: "proposed", quantity: 100, uomCode: "ea" }],
  };
  assert.equal(createOfficePartSchema.safeParse(input).success, false);
  assert.equal(createOfficePartSchema.safeParse({ ...input, allocations: [] }).success, true);
});

test("Office-created supplies begin only in source-compatible states", () => {
  const base = {
    query: "Oil filter",
    partNumber: "LF9009",
    quantity: 1,
    uomCode: "ea",
  };
  for (const status of ["issued", "installed", "returned", "cancelled"]) {
    assert.equal(createOfficePartSchema.safeParse({
      ...base,
      allocations: [{ sourceType: "inventory", status, quantity: 1, uomCode: "ea" }],
    }).success, false, `inventory must not begin ${status}`);
  }
  for (const [sourceType, statuses] of Object.entries(PART_ALLOCATION_INITIAL_STATUSES)) {
    for (const status of statuses) {
      assert.equal(createOfficePartSchema.safeParse({
        ...base,
        allocations: [{ sourceType, status, quantity: 1, uomCode: "ea" }],
      }).success, true, `${sourceType} may begin ${status}`);
    }
  }
});

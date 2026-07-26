import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_COMPANY_ID } from "../../db/company.js";
import { assignMechanicsSchema, createWorkorderSchema } from "./workorder.schemas.js";

const mechanic1 = "11111111-1111-4111-8111-111111111111";
const mechanic2 = "22222222-2222-4222-8222-222222222222";

test("multi-mechanic assignment removes duplicate IDs while preserving order", () => {
  const parsed = assignMechanicsSchema.parse({
    mechanicUserIds: [mechanic1, mechanic2, mechanic1],
    reason: "Two-person repair team",
  });

  assert.deepEqual(parsed.mechanicUserIds, [mechanic1, mechanic2]);
});

test("multi-mechanic assignment requires a reason and limits team size", () => {
  assert.throws(() => assignMechanicsSchema.parse({
    mechanicUserIds: [mechanic1],
    reason: "",
  }));

  assert.throws(() => assignMechanicsSchema.parse({
    mechanicUserIds: Array.from({ length: 11 }, (_, index) => (
      `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`
    )),
    reason: "Too many mechanics",
  }));
});

test("workorder creation accepts a deduped initial mechanic team", () => {
  const parsed = createWorkorderSchema.parse({
    companyId: "33333333-3333-4333-8333-333333333333",
    locationId: "44444444-4444-4444-8444-444444444444",
    concern: "Inspect coolant leak.",
    mechanicUserIds: [mechanic1, mechanic2, mechanic1],
  });

  assert.deepEqual(parsed.mechanicUserIds, [mechanic1, mechanic2]);
});

test("workorder creation accepts the canonical database company UUID", () => {
  const parsed = createWorkorderSchema.parse({
    companyId: DEFAULT_COMPANY_ID,
    locationId: "44444444-4444-4444-8444-444444444444",
    concern: "Inspect coolant leak.",
  });

  assert.equal(parsed.companyId, DEFAULT_COMPANY_ID);
});

test("workorder creation limits the initial team to 10 mechanics", () => {
  assert.throws(() => createWorkorderSchema.parse({
    companyId: "33333333-3333-4333-8333-333333333333",
    locationId: "44444444-4444-4444-8444-444444444444",
    concern: "Inspect coolant leak.",
    mechanicUserIds: Array.from({ length: 11 }, (_, index) => (
      `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`
    )),
  }));
});

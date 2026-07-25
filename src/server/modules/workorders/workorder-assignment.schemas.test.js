import assert from "node:assert/strict";
import test from "node:test";
import { assignMechanicsSchema } from "./workorder.schemas.js";

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

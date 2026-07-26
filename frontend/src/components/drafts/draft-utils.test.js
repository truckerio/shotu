import assert from "node:assert/strict";
import test from "node:test";
import {
  fingerprintDraftValue,
  mergeDraftResult,
  resolveMeaningful,
} from "./draft-utils.js";

test("fingerprintDraftValue ignores object key insertion order", () => {
  assert.equal(
    fingerprintDraftValue({ concern: "Brake issue", unit: { id: "G2001", vin: "123" } }),
    fingerprintDraftValue({ unit: { vin: "123", id: "G2001" }, concern: "Brake issue" }),
  );
});

test("mergeDraftResult keeps the optimistic version and fills a missing payload", () => {
  assert.deepEqual(
    mergeDraftResult(
      { id: "draft-1", version: 2, locationId: "yard-1" },
      { version: 3, updatedAt: "2026-07-25T12:00:00Z" },
      { concern: "Brake issue" },
    ),
    {
      id: "draft-1",
      version: 3,
      locationId: "yard-1",
      updatedAt: "2026-07-25T12:00:00Z",
      payload: { concern: "Brake issue" },
    },
  );
});

test("resolveMeaningful supports a boolean or value predicate", () => {
  assert.equal(resolveMeaningful(false, { unit: "G2001" }), false);
  assert.equal(resolveMeaningful((value) => Boolean(value.unit), { unit: "G2001" }), true);
});

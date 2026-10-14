import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInspectionFilters, readInspectionSession, writeInspectionSession } from "./inspection-session-state.js";

test("queue filters preserve valid choices and reject stale or malformed stored values", () => {
  assert.deepEqual(normalizeInspectionFilters({ unitType: "Truck", result: "passed", sort: "updated_asc" }), { locationId: "", mechanicId: "", unitType: "Truck", result: "passed", sort: "updated_asc" });
  assert.deepEqual(normalizeInspectionFilters({ unitType: "unknown", result: "unknown", sort: "DROP TABLE", locationId: "invalid", mechanicId: "invalid" }), { locationId: "", mechanicId: "", unitType: "", result: "", sort: "updated_desc" });
  assert.equal(normalizeInspectionFilters(null).sort, "updated_desc");
});

test("queue filters survive a refresh and inspection detail roundtrip", () => {
  const previous = globalThis.window;
  const storage = new Map();
  globalThis.window = { sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  try {
    const filters = { locationId: "11111111-1111-4111-8111-111111111111", mechanicId: "22222222-2222-4222-8222-222222222222", unitType: "Trailer", result: "issues_found", sort: "updated_asc" };
    writeInspectionSession("admin", { status: "completed", filters });
    assert.deepEqual(readInspectionSession("admin").filters, filters);
    writeInspectionSession("admin", { ...readInspectionSession("admin"), activeId: "" });
    assert.deepEqual(readInspectionSession("admin").filters, filters);
  } finally { globalThis.window = previous; }
});

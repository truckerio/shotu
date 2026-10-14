import assert from "node:assert/strict";
import test from "node:test";
import { checkpointPreview, readCheckpointFilters, readCheckpointPosition, saveCheckpointFilters, saveCheckpointPosition } from "./checkpoint-position.js";

test("checkpoint return memory is query-scoped and survives invalid/unavailable storage", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveCheckpointPosition("all", { page: 8, id: "wo-1", offset: -12 }, storage);
  assert.deepEqual(readCheckpointPosition("all", storage), { page: 8, id: "wo-1", offset: -12 });
  assert.equal(readCheckpointPosition("active", storage), null);
  assert.equal(readCheckpointPosition("bad", { getItem: () => "invalid" }), null);
  assert.doesNotThrow(() => saveCheckpointPosition("all", { page: 1 }, { setItem() { throw new Error(); } }));
});

test("hover previews use at most three already loaded workorders", () => {
  assert.equal(checkpointPreview(Array.from({ length: 20 }, (_, id) => ({ serial: `WO-${id}` }))).length, 3);
  assert.deepEqual(checkpointPreview(), []);
});

test("return filters preserve search per actor without crossing actor scope", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  saveCheckpointFilters("admin", { category: "all", search: "pump" }, storage);
  assert.deepEqual(readCheckpointFilters("admin", storage), { category: "all", search: "pump" });
  assert.equal(readCheckpointFilters("other-user", storage), null);
});

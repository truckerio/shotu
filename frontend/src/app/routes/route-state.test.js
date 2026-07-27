import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkorderSearch,
  draftsSearch,
  readInitialWorkspace,
  routeStartsLoading,
  workorderDetailSearch,
} from "./route-state.js";

test("route search builders preserve detail and draft URL contracts", () => {
  assert.equal(workorderDetailSearch("wo 1"), "?workorder=wo%201");
  assert.equal(workorderDetailSearch("wo 1", "activity"), "?workorder=wo%201&section=activity");
  assert.equal(createWorkorderSearch(), "?view=create");
  assert.equal(createWorkorderSearch("draft 1"), "?view=create&draft=draft%201");
  assert.equal(draftsSearch(), "?view=drafts");
});

test("initial workspace follows role and URL ownership", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { location: { search: "?workorder=wo-1" } };
  assert.equal(readInitialWorkspace({ role: "mechanic" }), "generator");
  assert.equal(readInitialWorkspace({ role: "office" }), "generator");
  assert.equal(routeStartsLoading(), true);

  globalThis.window = { location: { search: "" } };
  assert.equal(readInitialWorkspace({ role: "admin" }), "admin");
  assert.equal(readInitialWorkspace({ role: "surveillance" }), "surveillance");
  assert.equal(readInitialWorkspace({ role: "mechanic" }), "mechanic");
  assert.equal(readInitialWorkspace({ role: "office" }), "office");
  assert.equal(routeStartsLoading(), false);
  globalThis.window = previousWindow;
});

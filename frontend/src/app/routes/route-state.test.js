import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkorderSearch,
  defaultWorkspaceForRole,
  draftsSearch,
  inspectionReturnContext,
  inspectionWorkspaceSearch,
  readInitialWorkspace,
  routeStartsLoading,
  workspaceSearchForRole,
  workorderDetailSearch,
} from "./route-state.js";

test("route search builders preserve detail and draft URL contracts", () => {
  assert.equal(workorderDetailSearch("wo 1"), "?workorder=wo%201");
  assert.equal(workorderDetailSearch("wo 1", "activity"), "?workorder=wo%201&section=activity");
  assert.equal(
    workorderDetailSearch("wo 1", "parts", { partRequestId: "request 2" }),
    "?workorder=wo%201&section=parts&partRequest=request%202",
  );
  assert.equal(createWorkorderSearch(), "?view=create");
  assert.equal(createWorkorderSearch("draft 1"), "?view=create&draft=draft%201");
  assert.equal(draftsSearch(), "?view=drafts");
});

test("inspection Summary workorder routes retain only a valid completed-inspection return context", () => {
  const inspectionId = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(
    workorderDetailSearch("wo 1", "", { inspectionReturn: { from: "inspection", inspectionId, anchor: "summary" } }),
    `?workorder=wo%201&from=inspection&inspection=${inspectionId}&anchor=summary`,
  );
  assert.deepEqual(
    inspectionReturnContext(new URLSearchParams(`from=inspection&inspection=${inspectionId}&anchor=summary`)),
    { from: "inspection", inspectionId, anchor: "summary" },
  );
  assert.equal(
    workspaceSearchForRole("admin", { inspectionReturn: { from: "inspection", inspectionId, anchor: "summary" } }),
    `?adminView=operations&from=inspection&inspection=${inspectionId}&anchor=summary`,
  );
  assert.equal(
    workspaceSearchForRole("mechanic", { inspectionReturn: { from: "inspection", inspectionId, anchor: "summary" } }),
    `?from=inspection&inspection=${inspectionId}&anchor=summary`,
  );
  assert.equal(inspectionReturnContext(new URLSearchParams("from=inspection&inspection=not-an-id&anchor=summary")), null);
  assert.equal(inspectionReturnContext(new URLSearchParams(`from=other&inspection=${inspectionId}&anchor=summary`)), null);
  assert.equal(workspaceSearchForRole("office", { inspectionReturn: { from: "inspection", inspectionId: "not-an-id", anchor: "summary" } }), "");
  assert.equal(
    inspectionWorkspaceSearch("office", inspectionId, "reinspect"),
    `?from=inspection&inspection=${inspectionId}&anchor=reinspect`,
  );
});

test("parsed inspection context round-trips through workorder and workspace navigation", () => {
  const inspectionId = "123e4567-e89b-42d3-a456-426614174000";
  const source = new URLSearchParams(`from=inspection&inspection=${inspectionId}&anchor=summary`);
  const context = inspectionReturnContext(source);
  const workorderSearch = workorderDetailSearch("workorder-1", "assignment", { inspectionReturn: context });
  const returnedContext = inspectionReturnContext(new URLSearchParams(workorderSearch));
  assert.deepEqual(returnedContext, context);
  assert.equal(workspaceSearchForRole("admin", { inspectionReturn: returnedContext }), `?adminView=operations&from=inspection&inspection=${inspectionId}&anchor=summary`);
  assert.equal(workspaceSearchForRole("office", { inspectionReturn: returnedContext }), `?from=inspection&inspection=${inspectionId}&anchor=summary`);
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

test("fallback navigation returns every role to its own workspace", () => {
  assert.equal(defaultWorkspaceForRole("admin"), "admin");
  assert.equal(defaultWorkspaceForRole("surveillance"), "surveillance");
  assert.equal(defaultWorkspaceForRole("mechanic"), "mechanic");
  assert.equal(defaultWorkspaceForRole("office"), "office");
});

test("workorder back navigation returns admins to Operations", () => {
  assert.equal(workspaceSearchForRole("admin"), "?adminView=operations");
  assert.equal(workspaceSearchForRole("office"), "");
  assert.equal(workspaceSearchForRole("mechanic"), "");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  inspectionContextEndpoint,
  inspectionContextSources,
  loadWorkorderDetail,
  operationalDetailApiRole,
  workorderDetailEndpoint,
} from "./workorder-detail-loader.js";

test("admin and office share the office detail API while mechanic stays isolated", () => {
  assert.equal(operationalDetailApiRole("admin"), "office");
  assert.equal(operationalDetailApiRole("office"), "office");
  assert.equal(operationalDetailApiRole("mechanic"), "mechanic");
  assert.equal(operationalDetailApiRole("surveillance"), null);
  assert.equal(workorderDetailEndpoint("admin", "wo/a"), "/api/office/workorders/wo%2Fa");
});

test("detail loader records opened before fetching when requested", async () => {
  const calls = [];
  const detail = { workorder: { id: "wo-1" } };
  const result = await loadWorkorderDetail({
    role: "mechanic",
    workorderId: "wo-1",
    markOpened: true,
    request: async (...args) => {
      calls.push(args);
      return args[0].endsWith("/opened") ? {} : detail;
    },
  });
  assert.deepEqual(calls.map(([url]) => url), [
    "/api/mechanic/workorders/wo-1/opened",
    "/api/mechanic/workorders/wo-1",
    "/api/inspections/workorders/wo-1/context",
  ]);
  assert.equal(calls[0][1].method, "POST");
  assert.equal(result, detail);
});

test("surveillance cannot use the operational detail loader", async () => {
  await assert.rejects(
    loadWorkorderDetail({ role: "surveillance", workorderId: "wo-1" }),
    /own queue/,
  );
});

test("detail loads the authorized inspection context after the workorder and preserves detail when it is absent", async () => {
  const calls = [];
  const detail = { workorder: { id: "wo-1" } };
  const result = await loadWorkorderDetail({
    role: "office",
    workorderId: "wo-1",
    request: async (url) => {
      calls.push(url);
      return url.endsWith("/context")
        ? { inspectionContext: { workorderId: "wo-1", sources: [{ inspectionId: "inspection-1", eligible: true }] } }
        : detail;
    },
  });
  assert.equal(inspectionContextEndpoint("wo/a"), "/api/inspections/workorders/wo%2Fa/context");
  assert.deepEqual(calls, ["/api/office/workorders/wo-1", "/api/inspections/workorders/wo-1/context"]);
  assert.deepEqual(result.inspectionContext.sources, [{ inspectionId: "inspection-1", inspectionNumber: "Inspection", completedAt: "", result: "", eligible: true, blockerCode: "", blockerMessage: "" }]);

  const unavailable = await loadWorkorderDetail({
    role: "office",
    workorderId: "wo-1",
    request: async (url) => {
      if (url.endsWith("/context")) { const error = new Error("Not found"); error.status = 404; throw error; }
      return detail;
    },
  });
  assert.equal(unavailable.inspectionContext, undefined);
  assert.equal(unavailable.inspectionContextUnavailable, undefined);

  const failed = await loadWorkorderDetail({
    role: "office",
    workorderId: "wo-1",
    request: async (url) => {
      if (url.endsWith("/context")) { const error = new Error("Unavailable"); error.status = 500; throw error; }
      return detail;
    },
  });
  assert.equal(failed.workorder.id, "wo-1");
  assert.equal(failed.inspectionContextUnavailable, true);
});

test("inspection context only admits explicit source records", () => {
  assert.deepEqual(inspectionContextSources({ sources: [{ inspectionId: "a", inspectionNumber: "INS-1", eligible: false, blockerMessage: "Close repairs" }, { inspectionId: "" }] }), [
    { inspectionId: "a", inspectionNumber: "INS-1", completedAt: "", result: "", eligible: false, blockerCode: "", blockerMessage: "Close repairs" },
  ]);
});

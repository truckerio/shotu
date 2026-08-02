import assert from "node:assert/strict";
import test from "node:test";

import {
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

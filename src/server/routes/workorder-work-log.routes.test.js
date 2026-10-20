import assert from "node:assert/strict";
import test from "node:test";

import { handleWorkorderWorkLogApi } from "./workorder-work-log.routes.js";

const WORKORDER_ID = "11111111-1111-4111-8111-111111111111";
const ENTRY_ID = "22222222-2222-4222-8222-222222222222";
const context = { actor: { id: "actor-one" } };

async function run({ method, path, body = {}, dependencies = {} }) {
  const responses = [];
  const handled = await handleWorkorderWorkLogApi(
    { method },
    {},
    new URL(path, "http://localhost"),
    {
      requestContext: context,
      readBody: async () => body,
      sendJson: (_response, status, payload) => responses.push({ status, payload }),
    },
    dependencies,
  );
  return { handled, responses };
}

test("work-log routes expose the agreed read and write shapes", async () => {
  const calls = [];
  const view = {
    activityStatus: "ready", version: 1, canChangeStatus: true,
    canLogLabor: true, canManageLabor: false, entries: [], totalHours: 0,
    statusOptions: ["ready", "active", "on_hold", "waiting_parts", "waiting_office"],
  };
  const dependencies = {
    getWorkLog: async (...args) => { calls.push(["get", ...args]); return view; },
    patchStatus: async (...args) => { calls.push(["status", ...args]); return { ...view, activityStatus: "on_hold" }; },
    postLabor: async (...args) => { calls.push(["post", ...args]); return { ...view, totalHours: 1.5 }; },
    patchLabor: async (...args) => { calls.push(["patch", ...args]); return { ...view, totalHours: 2 }; },
  };
  assert.equal((await run({ method: "GET", path: `/api/workorders/${WORKORDER_ID}/work-log`, dependencies })).responses[0].status, 200);
  await run({
    method: "PATCH", path: `/api/workorders/${WORKORDER_ID}/work-log`,
    body: { status: "on_hold", expectedVersion: 1 }, dependencies,
  });
  await run({
    method: "POST", path: `/api/workorders/${WORKORDER_ID}/work-log/labor`,
    body: { id: ENTRY_ID, hours: 1.5, date: "2026-10-18", note: "Diagnosis" }, dependencies,
  });
  await run({
    method: "PATCH", path: `/api/workorders/${WORKORDER_ID}/work-log/labor/${ENTRY_ID}`,
    body: {
      hours: 2, date: "2026-10-18", note: "Diagnosis and repair", expectedVersion: 1,
      correctionReason: "Added repair time",
    }, dependencies,
  });
  assert.deepEqual(calls.map(([kind]) => kind), ["get", "status", "post", "patch"]);
  assert.equal(calls[2][3].minutes, 90);
  assert.equal(calls[3][4].minutes, 120);
  assert.equal(calls[3][3], ENTRY_ID);
});

test("labor correction can preserve and void a mistaken entry with zero hours", async () => {
  let input;
  await run({
    method: "PATCH",
    path: `/api/workorders/${WORKORDER_ID}/work-log/labor/${ENTRY_ID}`,
    body: {
      hours: 0, date: "2026-10-18", note: "Entered by mistake", expectedVersion: 2,
      correctionReason: "Void duplicate entry",
    },
    dependencies: { patchLabor: async (_context, _workorderId, _entryId, value) => { input = value; return {}; } },
  });
  assert.equal(input.minutes, 0);
});

test("work-log routes reject unknown status, fractional minutes, and missing correction reason", async () => {
  await assert.rejects(run({
    method: "PATCH", path: `/api/workorders/${WORKORDER_ID}/work-log`,
    body: { status: "done", expectedVersion: 1 },
  }), (error) => error.statusCode === 400);
  await assert.rejects(run({
    method: "POST", path: `/api/workorders/${WORKORDER_ID}/work-log/labor`,
    body: { id: ENTRY_ID, hours: 0.001, date: "2026-10-18", note: "" },
  }), (error) => error.statusCode === 400);
  await assert.rejects(run({
    method: "POST", path: `/api/workorders/${WORKORDER_ID}/work-log/labor`,
    body: { id: ENTRY_ID, hours: 1, date: "2026-02-30", note: "" },
  }), (error) => error.statusCode === 400);
  await assert.rejects(run({
    method: "PATCH", path: `/api/workorders/${WORKORDER_ID}/work-log/labor/${ENTRY_ID}`,
    body: { hours: 1, date: "2026-10-18", note: "", expectedVersion: 1 },
  }), (error) => error.statusCode === 400);
});

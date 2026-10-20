import assert from "node:assert/strict";
import test from "node:test";

import {
  getWorkorderWorkLog,
  patchWorkorderActivityStatus,
  patchWorkorderLabor,
  postWorkorderLabor,
} from "./workorder-work-log.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const workorderId = "22222222-2222-4222-8222-222222222222";
const mechanicId = "33333333-3333-4333-8333-333333333333";
const entryId = "44444444-4444-4444-8444-444444444444";

function context(role, actorId = mechanicId) {
  return {
    actor: { id: actorId, role },
    companyIds: new Set([companyId]),
    companyRoles: new Map([[companyId, role]]),
    locationIds: new Set(),
  };
}

function dependencies(role, overrides = {}) {
  const workorder = {
    id: workorderId, companyId, status: "accepted",
    mechanicIds: [mechanicId],
  };
  return {
    authorizeWrite: async () => ({ workorder }),
    canWriteProduct: async () => true,
    resolveAccess: async () => ({
      workorder,
      decisions: {
        assignment: { access: role === "surveillance" ? "read" : "write" },
        diagnosisRepair: { access: "write" },
      },
    }),
    readLog: async () => ({
      workorder: { id: workorderId, companyId, status: workorder.status, activityStatus: "ready", activityVersion: 1 },
      entries: [], totalMinutes: 0,
    }),
    ...overrides,
  };
}

test("work-log permissions derive from effective role, assignment, modules, and lifecycle", async () => {
  const mechanic = await getWorkorderWorkLog(context("mechanic"), workorderId, dependencies("mechanic"));
  assert.equal(mechanic.canChangeStatus, true);
  assert.equal(mechanic.canLogLabor, true);
  assert.equal(mechanic.canManageLabor, false);

  const office = await getWorkorderWorkLog(context("office", "office-one"), workorderId, dependencies("office"));
  assert.equal(office.canChangeStatus, true);
  assert.equal(office.canLogLabor, false);
  assert.equal(office.canManageLabor, true);

  const surveillance = await getWorkorderWorkLog(
    context("surveillance", "watcher-one"), workorderId, dependencies("surveillance"),
  );
  assert.equal(surveillance.canChangeStatus, false);
  assert.equal(surveillance.canLogLabor, false);
  assert.equal(surveillance.canManageLabor, false);
});

test("hidden diagnosis module does not expose labor entries or totals", async () => {
  const deps = dependencies("office");
  deps.resolveAccess = async () => ({
    workorder: { id: workorderId, companyId, status: "accepted", mechanicIds: [mechanicId] },
    decisions: { assignment: { access: "write" }, diagnosisRepair: { access: "hidden" } },
  });
  deps.readLog = async () => ({
    workorder: { id: workorderId, companyId, status: "accepted", activityStatus: "ready", activityVersion: 1 },
    entries: [{ id: entryId, note: "private labor note" }], totalMinutes: 120,
  });
  const view = await getWorkorderWorkLog(context("office", "office-one"), workorderId, deps);
  assert.deepEqual(view.entries, []);
  assert.equal(view.totalHours, 0);
  assert.equal(view.canManageLabor, false);
});

test("missing module decisions and product read-only mode fail capability projection closed", async () => {
  const missing = dependencies("office", {
    resolveAccess: async () => ({
      workorder: { id: workorderId, companyId, status: "accepted", mechanicIds: [mechanicId] },
      decisions: { assignment: { access: "write" } },
    }),
  });
  const missingView = await getWorkorderWorkLog(context("office", "office-one"), workorderId, missing);
  assert.deepEqual(missingView.entries, []);
  assert.equal(missingView.totalHours, 0);
  assert.equal(missingView.canManageLabor, false);

  const readOnly = dependencies("mechanic", { canWriteProduct: async () => false });
  const readOnlyView = await getWorkorderWorkLog(context("mechanic"), workorderId, readOnly);
  assert.equal(readOnlyView.canChangeStatus, false);
  assert.equal(readOnlyView.canLogLabor, false);
  assert.equal(readOnlyView.canManageLabor, false);
});

test("writes preserve tenant identity and mechanic ownership", async () => {
  const seen = [];
  const deps = dependencies("mechanic", {
    authorizeWrite: async (_context, _workorderId, request) => { seen.push(["authorize", request]); },
    changeStatus: async (input) => { seen.push(["status", input]); return true; },
    createLabor: async (input) => { seen.push(["create", input]); return true; },
    correctLabor: async (input) => { seen.push(["correct", input]); return true; },
  });
  await patchWorkorderActivityStatus(context("mechanic"), workorderId, { status: "on_hold", expectedVersion: 1 }, deps);
  await postWorkorderLabor(context("mechanic"), workorderId, {
    id: entryId, minutes: 60, date: "2026-10-18", note: "Inspection",
  }, deps);
  await patchWorkorderLabor(context("mechanic"), workorderId, entryId, {
    minutes: 90, date: "2026-10-18", note: "Inspection", expectedVersion: 1, correctionReason: "Correct duration",
  }, deps);
  assert.deepEqual(seen.map(([kind]) => kind), ["authorize", "status", "authorize", "create", "authorize", "correct"]);
  assert.equal(seen[1][1].companyId, companyId);
  assert.equal(seen[3][1].mechanicUserId, mechanicId);
  assert.equal(seen[5][1].mechanicUserId, mechanicId);
});

test("closed lifecycle and surveillance deny work-log writes", async () => {
  const terminal = dependencies("mechanic");
  const resolve = terminal.resolveAccess;
  terminal.resolveAccess = async (...args) => {
    const result = await resolve(...args);
    return { ...result, workorder: { ...result.workorder, status: "closed" } };
  };
  await assert.rejects(postWorkorderLabor(context("mechanic"), workorderId, {
    id: entryId, minutes: 60, date: "2026-10-18", note: "",
  }, terminal), (error) => error.statusCode === 403);
  await assert.rejects(patchWorkorderActivityStatus(
    context("surveillance", "watcher-one"), workorderId,
    { status: "active", expectedVersion: 1 }, dependencies("surveillance"),
  ), (error) => error.statusCode === 403);
});

test("mechanic-done work allows retrospective labor but locks operational status", async () => {
  const deps = dependencies("mechanic", { createLabor: async () => true });
  const resolve = deps.resolveAccess;
  deps.resolveAccess = async (...args) => {
    const result = await resolve(...args);
    return { ...result, workorder: { ...result.workorder, status: "mechanic_done" } };
  };
  const view = await getWorkorderWorkLog(context("mechanic"), workorderId, deps);
  assert.equal(view.canChangeStatus, false);
  assert.equal(view.canLogLabor, true);
  await postWorkorderLabor(context("mechanic"), workorderId, {
    id: entryId, minutes: 60, date: "2026-10-18", note: "Retrospective entry",
  }, deps);
});

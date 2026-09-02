import assert from "node:assert/strict";
import test from "node:test";
import {
  createMechanicWorkorderActions,
  mechanicActionResult,
  mechanicChatRequest,
  shouldPreserveMechanicWorkorderForm,
} from "./useMechanicWorkorderActions.js";

function actionHarness(overrides = {}) {
  const calls = [];
  const detail = {
    user: { name: "Mechanic One" },
    messages: [],
    workorder: {
      id: "workorder-1",
      diagnosis: "Checked brakes",
      workPerformed: "Replaced pads",
      progressVersion: 3,
      status: "open",
    },
  };
  const dependencies = {
    activeWorkorder: detail,
    apiRequest: async (...args) => {
      calls.push(["api", ...args]);
      return {};
    },
    detailLoader: async (...args) => {
      calls.push(["load", ...args]);
      return { ...detail, workorder: { ...detail.workorder, status: "accepted" } };
    },
    form: { diagnosis: "Checked brakes", workPerformed: "Replaced pads" },
    getActiveElement: () => null,
    isMechanicDetail: true,
    isOfficeDetail: false,
    mechanicProgress: {
      flush: async (...args) => calls.push(["flush", ...args]),
      hasUnsyncedChanges: false,
      reset: (...args) => calls.push(["reset", ...args]),
      status: "saved",
    },
    normalizeWorkorderForm: ({ detail: loaded }) => ({ loaded: loaded.workorder.id }),
    officeLocations: [{ id: "location-1" }],
    replaceRoute: (...args) => calls.push(["route", ...args]),
    setActiveWorkorder: (...args) => calls.push(["active", ...args]),
    setDetailSource: (...args) => calls.push(["source", ...args]),
    setDetailStatus: (...args) => calls.push(["status", ...args]),
    setForm: (...args) => calls.push(["form", ...args]),
    setMechanicAction: (...args) => calls.push(["action", ...args]),
    setMechanicFinish: (...args) => calls.push(["finish", ...args]),
    setOfficeCancel: (...args) => calls.push(["cancel", ...args]),
    setOfficeReturn: (...args) => calls.push(["return", ...args]),
    setPreviewPanelOpen: (...args) => calls.push(["preview", ...args]),
    setSelectedVehicle: (...args) => calls.push(["vehicle", ...args]),
    setWorkspace: (...args) => calls.push(["workspace", ...args]),
    ...overrides,
  };
  return {
    actions: createMechanicWorkorderActions(dependencies),
    calls,
    dependencies,
    detail,
  };
}

test("mechanicActionResult replaces a returned workorder and trusts its status", () => {
  const currentDetail = { messages: [], workorder: { id: "wo-1", status: "open" } };
  const workorder = { id: "wo-1", status: "accepted" };
  assert.deepEqual(mechanicActionResult({ currentDetail, result: { workorder } }), {
    detail: { messages: [], workorder },
    status: "accepted",
  });
});

test("mechanicActionResult appends a message with the current user fallback", () => {
  const currentDetail = {
    messages: [{ id: "message-1" }],
    user: { name: "Mechanic One" },
    workorder: { id: "wo-1", status: "accepted" },
  };
  const resolved = mechanicActionResult({
    currentDetail,
    result: { message: { id: "message-2", body: "Started" } },
    nextStatus: "in_progress",
  });
  assert.equal(resolved.status, "in_progress");
  assert.deepEqual(resolved.detail.messages[1], {
    id: "message-2",
    body: "Started",
    senderName: "Mechanic One",
  });
  assert.equal(resolved.detail.workorder.status, "in_progress");
});

test("mechanicChatRequest selects the actor role route and includes attachments", () => {
  const request = mechanicChatRequest({
    attachment: { key: "photo.jpg" },
    body: "Photo attached",
    clientMessageId: "client-1",
    isOfficeDetail: true,
    workorderId: "wo-1",
  });
  assert.equal(request.path, "/api/office/workorders/wo-1/messages");
  assert.deepEqual(JSON.parse(request.options.body), {
    attachment: { key: "photo.jpg" },
    body: "Photo attached",
    clientMessageId: "client-1",
  });
});

test("preservation protects unsynced mechanic progress and focused form controls", () => {
  assert.equal(shouldPreserveMechanicWorkorderForm({
    activeElement: null,
    isMechanicDetail: true,
    mechanicProgress: { hasUnsyncedChanges: true, status: "dirty" },
  }), true);
  assert.equal(shouldPreserveMechanicWorkorderForm({
    activeElement: { closest: (selector) => selector.includes("textarea") ? {} : null },
    isMechanicDetail: false,
    mechanicProgress: { hasUnsyncedChanges: false, status: "saved" },
  }), true);
});

test("returnToMyWork blocks navigation when the unsynced progress flush fails", async () => {
  const { actions, calls } = actionHarness({
    mechanicProgress: {
      flush: async () => { throw new Error("Progress unavailable."); },
      hasUnsyncedChanges: true,
      reset: () => {},
      status: "error",
    },
  });
  assert.equal(await actions.returnToMyWork(), false);
  assert.equal(calls.some(([name]) => name === "workspace"), false);
  assert.deepEqual(calls.at(-1), ["action", {
    busy: "",
    message: "Progress unavailable. Your recovery copy is still on this device. Retry before leaving.",
  }]);
});

test("returnToMyWork flushes progress before clearing detail navigation", async () => {
  const { actions, calls } = actionHarness({
    mechanicProgress: {
      flush: async (...args) => calls.push(["flush", ...args]),
      hasUnsyncedChanges: true,
      reset: () => {},
      status: "dirty",
    },
  });
  assert.equal(await actions.returnToMyWork(), true);
  assert.deepEqual(calls[0], ["action", { busy: "progress", message: "Saving progress before leaving..." }]);
  assert.deepEqual(calls[1], ["flush", { recordActivity: true }]);
  assert.deepEqual(calls.at(-2), ["workspace", "mechanic"]);
  assert.deepEqual(calls.at(-1), ["route", ""]);
});

test("accept reloads mechanic detail, normalizes the form, and resets progress version", async () => {
  const { actions, calls, detail } = actionHarness();
  assert.equal(await actions.acceptOpenedMechanicWorkorder(), true);
  assert.deepEqual(calls[0], [
    "action",
    { busy: "accept", message: "" },
  ]);
  assert.deepEqual(calls[1], [
    "api",
    "/api/mechanic/workorders/workorder-1/accept",
    { method: "POST", body: "{}" },
  ]);
  const reset = calls.find(([name]) => name === "reset");
  assert.deepEqual(reset, ["reset", {
    id: detail.workorder.id,
    progress: { ...detail.workorder, status: "accepted" },
    nextVersion: detail.workorder.progressVersion,
  }]);
});

test("chat posts through the mechanic route and reloads the shared detail", async () => {
  const { actions, calls } = actionHarness();
  assert.equal(await actions.sendWorkorderChat({
    body: "Part is ready",
    clientMessageId: "client-message-1",
  }), true);
  assert.deepEqual(calls.find(([name]) => name === "api"), [
    "api",
    "/api/mechanic/workorders/workorder-1/messages",
    {
      method: "POST",
      body: JSON.stringify({
        body: "Part is ready",
        clientMessageId: "client-message-1",
      }),
    },
  ]);
  assert.deepEqual(calls.find(([name]) => name === "load"), [
    "load",
    { role: "mechanic", workorderId: "workorder-1" },
  ]);
});

test("chat refresh preserves unsynced mechanic progress after the message commits", async () => {
  const { actions, calls } = actionHarness({
    mechanicProgress: {
      flush: async () => {},
      hasUnsyncedChanges: true,
      reset: () => {},
      status: "dirty",
    },
  });

  assert.equal(await actions.sendWorkorderChat({
    body: "Photo and update sent",
    clientMessageId: "client-message-2",
  }), true);
  const apiIndex = calls.findIndex(([name]) => name === "api");
  const loadIndex = calls.findIndex(([name]) => name === "load");
  assert.ok(apiIndex >= 0 && loadIndex > apiIndex);
  assert.equal(calls.some(([name]) => name === "form"), false);
});

test("detail reload preserves an actively edited form when requested", async () => {
  const { actions, calls } = actionHarness();
  await actions.reloadActiveWorkorder({ preserveForm: true });
  assert.equal(calls.some(([name]) => name === "form"), false);
  assert.deepEqual(calls.find(([name]) => name === "status"), ["status", "accepted"]);
});

test("mark done flushes progress before posting the preserved diagnosis and repair", async () => {
  const { actions, calls } = actionHarness();
  assert.equal(await actions.markMechanicWorkDone(), true);
  const flushIndex = calls.findIndex(([name]) => name === "flush");
  const apiIndex = calls.findIndex(([name, path]) => name === "api" && path.endsWith("/mark-done"));
  assert.ok(flushIndex >= 0 && apiIndex > flushIndex);
  assert.deepEqual(JSON.parse(calls[apiIndex][2].body), {
    diagnosis: "Checked brakes",
    workPerformed: "Replaced pads",
  });
});

test("mark done reuses part repair orders when repair completed is blank", async () => {
  const { actions, calls } = actionHarness({
    form: {
      diagnosis: "Hub seal leaking",
      workPerformed: "",
      parts: [
        { partNo: "46305", repairOrder: "Put new hub seal, adjust brakes" },
        { partNo: "46305-C24", repairOrder: "put new hub seal, adjust brakes" },
      ],
    },
  });

  assert.equal(await actions.markMechanicWorkDone(), true);
  const apiCall = calls.find(([name, path]) => name === "api" && path.endsWith("/mark-done"));
  assert.deepEqual(JSON.parse(apiCall[2].body), {
    diagnosis: "Hub seal leaking",
    workPerformed: "Put new hub seal, adjust brakes",
  });
});

test("mark done reuses persisted serialized repair orders when manual parts are blank", async () => {
  const detail = {
    user: { name: "Mechanic One" },
    messages: [],
    modules: { parts: { data: { installedSerializedParts: [{
      usageId: "usage-1", partNumber: "0000000002211", quantity: 1, uomCode: "ea", repairOrder: "Replace failed sensor",
    }] } } },
    workorder: { id: "workorder-1", diagnosis: "Sensor fault", workPerformed: "", status: "open" },
  };
  const { actions, calls } = actionHarness({ activeWorkorder: detail, form: { diagnosis: "Sensor fault", workPerformed: "", parts: [] } });

  assert.equal(await actions.markMechanicWorkDone(), true);
  const apiCall = calls.find(([name, path]) => name === "api" && path.endsWith("/mark-done"));
  assert.deepEqual(JSON.parse(apiCall[2].body), {
    diagnosis: "Sensor fault",
    workPerformed: "Replace failed sensor",
  });
});

test("submit finish allows blank diagnosis and repair details", async () => {
  const { actions, calls } = actionHarness({
    form: { diagnosis: "", workPerformed: "", parts: [] },
  });
  let prevented = false;
  assert.equal(await actions.submitMechanicFinish({ preventDefault: () => { prevented = true; } }), true);
  assert.equal(prevented, true);
  const apiCall = calls.find(([name, path]) => name === "api" && path.endsWith("/mark-done"));
  assert.deepEqual(JSON.parse(apiCall[2].body), { diagnosis: "", workPerformed: "" });
  assert.deepEqual(calls.at(-1), ["finish", { open: false, name: "", message: "" }]);
});

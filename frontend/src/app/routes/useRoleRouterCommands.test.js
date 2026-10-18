import assert from "node:assert/strict";
import test from "node:test";

import { createdWorkorderMessage, useRoleRouterCommands } from "./useRoleRouterCommands.js";

test("create confirmation reflects role and assignment outcome", () => {
  assert.equal(createdWorkorderMessage({ mechanic: true, serial: "WO-1" }), "WO-1 created and assigned to you.");
  assert.equal(createdWorkorderMessage({ assigned: true, serial: "WO-2" }), "WO-2 created and assigned.");
  assert.equal(createdWorkorderMessage({ assigned: false, serial: "WO-3" }), "WO-3 added to the available queue.");
});

function mechanicCreateCommands({ customerCompanyName = "", payloadCustomer = customerCompanyName } = {}) {
  const state = { errors: null, message: null, attempt: 0, opened: null };
  const form = {
    authorizationClassification: "approval_not_required",
    locationId: "location-1",
    unitNo: "G2021",
    mechanicConcern: "Inspect brakes",
    customerCompanyName,
  };
  const workorderDraftPayload = { formData: { customerCompanyName: payloadCustomer } };
  const commands = useRoleRouterCommands({
    actor: { role: "mechanic" },
    createAssignment: { mechanicUserIds: [] },
    form,
    workorderDraftPayload,
    setCreateAttempt: (update) => { state.attempt = typeof update === "function" ? update(state.attempt) : update; },
    setCreateErrors: (errors) => { state.errors = errors; },
    setCreateState: (message) => { state.message = message; },
    openOperationalWorkorder: (detail) => { state.opened = detail; },
  });
  return { commands, form, state, workorderDraftPayload };
}

test("mechanic customer name is highlighted before any create request and remains entered", async () => {
  const previousFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error("Unexpected request"); };
  try {
    const { commands, form, state, workorderDraftPayload } = mechanicCreateCommands({ customerCompanyName: "Autofilled owner" });
    await commands.createWorkorder({ preventDefault() {} });
    assert.equal(requests, 0);
    assert.match(state.errors.customerCompanyName, /Office.*accepted Estimate/);
    assert.equal(state.attempt, 1);
    assert.equal(form.customerCompanyName, "Autofilled owner");
    assert.equal(workorderDraftPayload.formData.customerCompanyName, "Autofilled owner");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("mechanic can submit blank-customer internal fleet work", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (path, options) => {
    requests.push({ path, options });
    return { ok: true, json: async () => path === "/api/workorders"
      ? { workorder: { id: "workorder-1", serial: "WO-1" } }
      : { workorder: { id: "workorder-1" } } };
  };
  try {
    const { commands, state } = mechanicCreateCommands();
    await commands.createWorkorder();
    assert.equal(requests[0].path, "/api/workorders");
    assert.equal(JSON.parse(requests[0].options.body).formData.customerCompanyName, "");
    assert.equal(requests[1].path, "/api/mechanic/workorders/workorder-1");
    assert.equal(state.opened.workorder.id, "workorder-1");
    assert.equal(state.message.error, false);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("server customer-workflow rejection retains its code for actionable UI guidance", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 409,
    json: async () => ({ code: "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED", error: "Customer Workorders must be issued through Office." }),
  });
  try {
    const { commands, state } = mechanicCreateCommands({ payloadCustomer: "Stale owner" });
    await commands.createWorkorder();
    assert.equal(state.message.code, "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED");
    assert.equal(state.message.error, true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

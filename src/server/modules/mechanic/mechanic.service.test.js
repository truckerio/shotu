import assert from "node:assert/strict";
import test from "node:test";
import { mechanicAllowedActions } from "./mechanic.service.js";

const mechanicId = "mechanic-1";

test("assigned mechanic chat stays available after repair editing locks", () => {
  for (const status of ["mechanic_done", "closed", "odoo_entered"]) {
    const actions = mechanicAllowedActions({ status, mechanicIds: [mechanicId] }, mechanicId);
    assert.equal(actions.sendMessage, true, `${status} should keep chat available`);
    assert.equal(actions.saveNotes, false);
    assert.equal(actions.requestParts, false);
    assert.equal(actions.markDone, false);
  }
});

test("unassigned mechanic cannot chat on another mechanic's workorder", () => {
  const actions = mechanicAllowedActions(
    { status: "in_progress", mechanicIds: ["mechanic-2"] },
    mechanicId,
  );
  assert.equal(actions.sendMessage, false);
  assert.equal(actions.saveNotes, false);
});

test("active assigned work keeps chat and repair actions available", () => {
  const actions = mechanicAllowedActions(
    { status: "in_progress", mechanicIds: [mechanicId] },
    mechanicId,
  );
  assert.equal(actions.sendMessage, true);
  assert.equal(actions.saveNotes, true);
  assert.equal(actions.requestParts, true);
  assert.equal(actions.markDone, true);
});

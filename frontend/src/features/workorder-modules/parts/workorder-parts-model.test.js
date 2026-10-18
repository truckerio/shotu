import assert from "node:assert/strict";
import test from "node:test";

import { canScanWorkorderParts } from "./workorder-parts-model.js";

test("mechanic preview scanner follows actor assignment rather than accept action", () => {
  const writable = { moduleAccess: { partsScanning: { access: "write" } } };
  const unassigned = { ...writable, workorder: { mechanicIds: [], mechanics: [] }, allowedActions: { accept: true } };
  const assignedToAnother = { ...writable, workorder: { mechanicIds: ["mechanic-2"], mechanics: [{ id: "mechanic-2" }] }, allowedActions: { accept: false } };
  const assignedToSelf = { ...writable, workorder: { mechanicIds: ["mechanic-1"], mechanics: [{ id: "mechanic-1" }] }, allowedActions: { accept: false } };
  assert.equal(canScanWorkorderParts(unassigned, true, "mechanic-1"), false);
  assert.equal(canScanWorkorderParts(assignedToAnother, true, "mechanic-1"), false);
  assert.equal(canScanWorkorderParts(assignedToSelf, true, "mechanic-1"), true);
  assert.equal(canScanWorkorderParts({ ...assignedToSelf, workorder: { ...assignedToSelf.workorder, status: "mechanic_done" } }, true, "mechanic-1"), true);
  assert.equal(canScanWorkorderParts(assignedToSelf, true), false);
  assert.equal(canScanWorkorderParts(assignedToAnother, false), true);
});

test("mechanic scanner accepts canonical team and legacy single mechanic projections", () => {
  const writable = { moduleAccess: { partsScanning: { access: "write" } } };
  assert.equal(canScanWorkorderParts({ ...writable, workorder: { mechanics: [{ id: "mechanic-1" }] } }, true, "mechanic-1"), true);
  assert.equal(canScanWorkorderParts({ ...writable, workorder: { mechanic: { id: "mechanic-1" } } }, true, "mechanic-1"), true);
  assert.equal(canScanWorkorderParts({ ...writable, workorder: { mechanicIds: [], mechanic: { id: "mechanic-1" } } }, true, "mechanic-1"), false);
});

test("scanner still requires write or required policy access", () => {
  for (const access of [undefined, "hidden", "read"]) {
    assert.equal(canScanWorkorderParts({ moduleAccess: { partsScanning: { access } } }, false), false);
  }
  assert.equal(canScanWorkorderParts({ moduleAccess: { partsScanning: { access: "required" } } }, false), true);
});

import assert from "node:assert/strict";
import test from "node:test";

import { officeAllowedActions } from "./office.service.js";

test("office and admin detail can chat while work is active or awaiting review", () => {
  for (const status of ["open", "accepted", "in_progress", "mechanic_done"]) {
    assert.equal(officeAllowedActions(status).sendMessage, true, status);
  }
  for (const status of ["closed", "odoo_entered", "cancelled"]) {
    assert.equal(officeAllowedActions(status).sendMessage, false, status);
  }
});

test("office can mark active work done, including work not assigned to a mechanic", () => {
  for (const status of ["open", "accepted", "in_progress"]) {
    assert.equal(officeAllowedActions(status).markDone, true, status);
  }
  for (const status of ["mechanic_done", "closed", "odoo_entered", "cancelled"]) {
    assert.equal(officeAllowedActions(status).markDone, false, status);
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import { createdWorkorderMessage } from "./useRoleRouterCommands.js";

test("create confirmation reflects role and assignment outcome", () => {
  assert.equal(createdWorkorderMessage({ mechanic: true, serial: "WO-1" }), "WO-1 created and assigned to you.");
  assert.equal(createdWorkorderMessage({ assigned: true, serial: "WO-2" }), "WO-2 created and assigned.");
  assert.equal(createdWorkorderMessage({ assigned: false, serial: "WO-3" }), "WO-3 added to the available queue.");
});

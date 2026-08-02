import assert from "node:assert/strict";
import test from "node:test";

import { roleCapabilities, roleCanOpenOperationalDetail } from "./role-capabilities.js";

test("role capabilities keep admin and office creation privileges aligned", () => {
  for (const role of ["admin", "office"]) {
    const capabilities = roleCapabilities(role);
    assert.equal(capabilities.canAssignCreateWorkorder, true);
    assert.equal(capabilities.canManageDrafts, true);
    assert.equal(capabilities.canPrintWorkorder, true);
    assert.equal(capabilities.templateApiRole, "office");
  }
});

test("mechanic creation is self-assigned without office draft privileges", () => {
  const capabilities = roleCapabilities("mechanic");
  assert.equal(capabilities.canAssignCreateWorkorder, false);
  assert.equal(capabilities.canManageDrafts, false);
  assert.equal(capabilities.canPrintWorkorder, false);
  assert.equal(capabilities.createMode, "mechanic");
  assert.equal(capabilities.templateApiRole, "mechanic");
});

test("only operational roles open shared office or mechanic detail routes", () => {
  assert.equal(roleCanOpenOperationalDetail("admin"), true);
  assert.equal(roleCanOpenOperationalDetail("office"), true);
  assert.equal(roleCanOpenOperationalDetail("mechanic"), true);
  assert.equal(roleCanOpenOperationalDetail("surveillance"), false);
});

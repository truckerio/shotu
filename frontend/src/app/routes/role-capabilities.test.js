import assert from "node:assert/strict";
import test from "node:test";

import {
  roleCapabilities,
  roleCanCreateWorkorder,
  roleCanCreateWorkorderForAnyLocation,
  roleCanOpenOperationalDetail,
} from "./role-capabilities.js";

test("role capabilities keep admin and office creation privileges aligned", () => {
  for (const role of ["admin", "office"]) {
    const capabilities = roleCapabilities(role);
    assert.equal(capabilities.canAssignCreateWorkorder, true);
    assert.equal(capabilities.canManageDrafts, true);
    assert.equal(capabilities.canPrintWorkorder, true);
    assert.equal("templateApiRole" in capabilities, false);
  }
});

test("mechanic creation is self-assigned without office draft privileges", () => {
  const capabilities = roleCapabilities("mechanic");
  assert.equal(capabilities.canAssignCreateWorkorder, false);
  assert.equal(capabilities.canManageDrafts, false);
  assert.equal(capabilities.canPrintWorkorder, false);
  assert.equal(capabilities.createMode, "mechanic");
  assert.equal("templateApiRole" in capabilities, false);
});

test("only operational roles open shared office or mechanic detail routes", () => {
  assert.equal(roleCanOpenOperationalDetail("admin"), true);
  assert.equal(roleCanOpenOperationalDetail("office"), true);
  assert.equal(roleCanOpenOperationalDetail("mechanic"), true);
  assert.equal(roleCanOpenOperationalDetail("surveillance"), false);
});

test("V2 module policy can grant create without changing role defaults", () => {
  assert.equal(roleCanCreateWorkorder("surveillance"), false);
  assert.equal(roleCanCreateWorkorder("surveillance", {
    moduleAccess: {
      surveillance: {
        create: {
          unit: "write",
        },
      },
    },
  }), true);
});

test("create entry points use location and user module policy", () => {
  const locationPolicy = {
    userModuleAccess: {
      "surv-1": {
        create: {
          unit: "write",
        },
      },
    },
  };

  assert.equal(roleCanCreateWorkorderForAnyLocation("surveillance", [{ policy: locationPolicy }], "surv-1"), true);
  assert.equal(roleCanCreateWorkorderForAnyLocation("surveillance", [{ policy: locationPolicy }], "surv-2"), false);
  assert.equal(roleCanCreateWorkorderForAnyLocation("surveillance", [], "surv-1"), false);
});

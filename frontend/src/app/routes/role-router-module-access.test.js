import assert from "node:assert/strict";
import test from "node:test";

import {
  activeWorkorderModulePolicy,
  projectedModuleAccessPolicy,
} from "./role-router-module-access.js";
import { resolveWorkorderModulePolicy } from "../../features/workorder-modules/workorder-module-registry.js";

test("server-effective module decisions become the detail policy source", () => {
  const policy = projectedModuleAccessPolicy({
    completion: { access: "read", source: "location" },
    diagnosisRepair: { access: "hidden", source: "user" },
  }, "mechanic");

  assert.equal(resolveWorkorderModulePolicy({
    moduleId: "completion",
    overrides: policy,
    role: "mechanic",
    surface: "detail",
  }).access, "read");
  assert.equal(resolveWorkorderModulePolicy({
    moduleId: "diagnosisRepair",
    overrides: policy,
    role: "mechanic",
    surface: "detail",
  }).access, "hidden");
});

test("projected server decisions win over incomplete legacy policy snapshots", () => {
  const policy = activeWorkorderModulePolicy({
    actorRole: "mechanic",
    activeWorkorder: {
      moduleAccess: { parts: { access: "hidden", source: "company" } },
      policy: { mechanicCanRecordParts: true },
    },
  });

  assert.deepEqual(policy, {
    moduleAccess: { mechanic: { detail: { parts: "hidden" } } },
  });
});

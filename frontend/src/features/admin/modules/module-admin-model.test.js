import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveModuleAccess,
  filterAdminModules,
  MODULE_ACCESS_LABELS,
  moduleAccessOptions,
  moduleAccessOverride,
  modulePolicyRuleChanges,
  moduleSupportsWrite,
  presentedModuleAccess,
  roleModuleAccess,
  updateRoleModuleAccess,
  updateModuleAccessOverride,
  updateUserModuleException,
} from "./module-admin-model.js";
import {
  WORKORDER_ACCESS_MODES,
  WORKORDER_INHERIT_ACCESS,
  WORKORDER_MODULES,
} from "../../../../../shared/workorder-modules.js";

test("module search uses the canonical shared catalog", () => {
  assert.deepEqual(filterAdminModules(WORKORDER_MODULES, "part requests").map(({ key }) => key), ["parts"]);
  assert.deepEqual(filterAdminModules(WORKORDER_MODULES, "ODOO").map(({ key }) => key), ["odoo"]);
  assert.equal(filterAdminModules(WORKORDER_MODULES, "").length, WORKORDER_MODULES.length);
});

test("admin language maps policy modes to Off, View, and Edit", () => {
  assert.equal(MODULE_ACCESS_LABELS.hidden, "Off");
  assert.equal(MODULE_ACCESS_LABELS.read, "View");
  assert.equal(MODULE_ACCESS_LABELS.write, "Edit");
});

test("catalog capabilities prevent false Edit and Required promises", () => {
  const activity = WORKORDER_MODULES.find(({ key }) => key === "activity");
  const parts = WORKORDER_MODULES.find(({ key }) => key === "parts");
  assert.equal(moduleSupportsWrite(activity), false);
  assert.deepEqual(moduleAccessOptions(activity, { includeInherit: true }), ["inherit", "hidden", "read"]);
  assert.equal(presentedModuleAccess(activity, WORKORDER_ACCESS_MODES.WRITE), WORKORDER_ACCESS_MODES.READ);
  assert.equal(presentedModuleAccess(activity, WORKORDER_ACCESS_MODES.REQUIRED), WORKORDER_ACCESS_MODES.READ);
  assert.equal(moduleSupportsWrite(parts), true);
  assert.deepEqual(moduleAccessOptions(parts), ["hidden", "read", "write"]);
  assert.doesNotMatch(moduleAccessOptions(parts).join(" "), /required/);
  assert.equal(moduleSupportsWrite(parts, { role: "surveillance", surface: "detail" }), true);
  assert.deepEqual(
    moduleAccessOptions(parts, { role: "surveillance", surface: "detail" }),
    ["hidden", "read", "write"],
  );
  assert.equal(moduleSupportsWrite(parts, { role: "office", surface: "detail" }), true);
  assert.equal(
    presentedModuleAccess(parts, WORKORDER_ACCESS_MODES.REQUIRED, { role: "office", surface: "create" }),
    WORKORDER_ACCESS_MODES.WRITE,
  );
});

test("role updates preserve the rest of the normalized policy", () => {
  const policy = updateRoleModuleAccess({}, "office", "detail", "odoo", WORKORDER_ACCESS_MODES.READ);
  assert.equal(roleModuleAccess(policy, "office", "detail", "odoo"), WORKORDER_ACCESS_MODES.READ);
  assert.equal(roleModuleAccess(policy, "mechanic", "detail", "odoo"), WORKORDER_ACCESS_MODES.HIDDEN);
});

test("user exception wins and removing it restores the role setting", () => {
  const user = { id: "user-1", role: "office" };
  const rolePolicy = updateRoleModuleAccess({}, "office", "detail", "odoo", WORKORDER_ACCESS_MODES.READ);
  const custom = updateUserModuleException(rolePolicy, user.id, "detail", "odoo", WORKORDER_ACCESS_MODES.WRITE);
  assert.deepEqual(effectiveModuleAccess({
    companyPolicy: null,
    locationPolicy: custom,
    moduleKey: "odoo",
    role: user.role,
    surface: "detail",
    userId: user.id,
  }), {
    access: WORKORDER_ACCESS_MODES.WRITE,
    source: "user",
    sourceLabel: "Location user exception",
  });

  const inherited = updateUserModuleException(custom, user.id, "detail", "odoo", WORKORDER_INHERIT_ACCESS);
  assert.deepEqual(effectiveModuleAccess({
    companyPolicy: null,
    locationPolicy: inherited,
    moduleKey: "odoo",
    role: user.role,
    surface: "detail",
    userId: user.id,
  }), {
    access: WORKORDER_ACCESS_MODES.READ,
    source: "location",
    sourceLabel: "Location override",
  });
  assert.deepEqual(inherited.userModuleAccess, {});
});

test("company user exception applies before role defaults", () => {
  const companyPolicy = updateUserModuleException({}, "user-2", "detail", "odoo", WORKORDER_ACCESS_MODES.WRITE);
  assert.deepEqual(effectiveModuleAccess({
    companyPolicy,
    locationPolicy: null,
    moduleKey: "odoo",
    role: "office",
    surface: "detail",
    userId: "user-2",
  }), {
    access: WORKORDER_ACCESS_MODES.WRITE,
    source: "company_user",
    sourceLabel: "Company user exception",
  });
});

test("company and location overrides stay sparse and inherit cleanly", () => {
  const company = updateModuleAccessOverride({}, "office", "detail", "odoo", WORKORDER_ACCESS_MODES.READ);
  assert.equal(moduleAccessOverride(company, "office", "detail", "odoo"), WORKORDER_ACCESS_MODES.READ);
  assert.deepEqual(company.moduleAccess, { office: { detail: { odoo: "read" } } });

  const inherited = updateModuleAccessOverride(company, "office", "detail", "odoo", WORKORDER_INHERIT_ACCESS);
  assert.deepEqual(inherited.moduleAccess, {});
  assert.equal(moduleAccessOverride(inherited, "office", "detail", "odoo"), WORKORDER_INHERIT_ACCESS);
});

test("canonical rule patches separate Required and preserve reset intent", () => {
  const before = {
    moduleAccess: { office: { create: { concern: "required" }, detail: { odoo: "read" } } },
    userModuleAccess: { "user-1": { detail: { parts: "write" } } },
  };
  const after = {
    moduleAccess: { office: { create: { concern: "write" } } },
    userModuleAccess: {},
  };
  const changes = modulePolicyRuleChanges(before, after, {
    roles: ["office"],
    modules: WORKORDER_MODULES.filter(({ key }) => ["concern", "odoo", "parts"].includes(key)),
  });
  assert.deepEqual(changes, [
    { targetType: "role", targetId: "office", moduleKey: "concern", surface: "create", access: "write", required: false },
    { targetType: "role", targetId: "office", moduleKey: "odoo", surface: "detail", access: "inherit", required: false },
    { targetType: "user", targetId: "user-1", moduleKey: "parts", surface: "detail", access: "inherit", required: false },
  ]);
});

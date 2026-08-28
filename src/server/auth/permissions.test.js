import assert from "node:assert/strict";
import test from "node:test";
import { requireCompanyAccess, requireLocationAccess, requirePermission } from "./authorize.js";
import { PERMISSION, permissionsForRole, roleHasPermission } from "./permissions.js";
import { USER_ROLES } from "./roles.js";

test("role permission matrix keeps domain capabilities separate", () => {
  for (const role of USER_ROLES) {
    assert.equal(roleHasPermission(role, PERMISSION.AUTHENTICATED), true);
  }
  assert.equal(roleHasPermission("mechanic", PERMISSION.WORKORDER_MECHANIC), true);
  assert.equal(roleHasPermission("mechanic", PERMISSION.AUTHENTICATED), true);
  assert.equal(roleHasPermission("office", PERMISSION.WORKORDER_CHAT_READ), true);
  assert.equal(roleHasPermission("surveillance", PERMISSION.WORKORDER_CHAT_READ), false);
  assert.equal(roleHasPermission("mechanic", PERMISSION.WORKORDER_OFFICE), false);
  assert.equal(roleHasPermission("office", PERMISSION.PART_PRICE), true);
  assert.equal(roleHasPermission("surveillance", PERMISSION.WORKORDER_SURVEILLANCE), true);
  assert.equal(roleHasPermission("admin", PERMISSION.INTEGRATION_ADMIN), true);
  assert.equal(roleHasPermission("admin", PERMISSION.INVENTORY_COUNT_APPLY), true);
  assert.equal(roleHasPermission("office", PERMISSION.INVENTORY_COUNT_APPLY), false);
});

test("authorization rejects anonymous and wrong-role contexts", () => {
  assert.throws(() => requirePermission(null, PERMISSION.WORKORDER_MECHANIC), (error) => error.statusCode === 401);
  assert.throws(
    () => requirePermission({ actor: { role: "mechanic" }, permissions: permissionsForRole("mechanic") }, PERMISSION.WORKORDER_OFFICE),
    (error) => error.statusCode === 403,
  );
});

test("location authorization allows memberships and admin override", () => {
  const mechanic = { actor: { role: "mechanic" }, locationIds: new Set(["location-a"]) };
  assert.equal(requireLocationAccess(mechanic, "location-a").role, "mechanic");
  assert.throws(() => requireLocationAccess(mechanic, "location-b"), (error) => error.statusCode === 403);
  assert.equal(requireLocationAccess({ actor: { role: "admin" }, locationIds: new Set() }, "location-b").role, "admin");
});

test("company authorization requires membership for every role", () => {
  const office = { actor: { role: "office" }, companyIds: new Set(["default"]) };
  assert.equal(requireCompanyAccess(office, "default").role, "office");
  assert.throws(() => requireCompanyAccess(office, "other"), (error) => error.statusCode === 403);
  assert.throws(
    () => requireCompanyAccess({ actor: { role: "admin" }, companyIds: new Set() }, "other"),
    (error) => error.statusCode === 403,
  );
  assert.equal(
    requireCompanyAccess({ actor: { role: "admin" }, companyIds: new Set(["other"]) }, "other").role,
    "admin",
  );
});

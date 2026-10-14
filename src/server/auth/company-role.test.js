import assert from "node:assert/strict";
import test from "node:test";
import { companyRoleScope, effectiveCompanyContext, effectiveCompanyRole, requireCompanyRole } from "./company-role.js";
import { requireLocationAccess } from "./authorize.js";
import { requireWorkorderAccess } from "./resource-access.js";
import { PERMISSION } from "./permissions.js";

function context(roleA = "admin", roleB = "mechanic") {
  return { actor: { id: "user", role: "admin" }, sessionMode: "standard", companyIds: new Set(["A", "B"]),
    companyRoles: new Map([["A", roleA], ["B", roleB]]), locationIds: new Set(["B-assigned"]) };
}

test("each company role stays independent of the primary workspace role", () => {
  for (const pair of [["admin", "mechanic"], ["admin", "office"], ["office", "mechanic"], ["surveillance", "admin"]]) {
    const original = context(...pair);
    assert.equal(effectiveCompanyRole(original, "A"), pair[0]);
    const scoped = effectiveCompanyContext(original, "B");
    assert.equal(scoped.actor.role, pair[1]);
    assert.deepEqual([...scoped.companyIds], ["B"]);
    assert.equal(original.actor.role, "admin");
    assert.deepEqual([...original.companyIds], ["A", "B"]);
  }
});

test("missing, stale, invalid and cross-company memberships fail closed", () => {
  const value = context();
  assert.equal(effectiveCompanyRole(value, "C"), null);
  value.companyRoles.delete("B");
  assert.equal(effectiveCompanyRole(value, "B"), null);
  assert.throws(() => effectiveCompanyContext(value, "B"), (error) => error.statusCode === 404);
  value.companyRoles.set("B", "owner");
  assert.equal(effectiveCompanyRole(value, "B"), null);
  delete value.companyRoles;
  assert.equal(effectiveCompanyRole(value, "A"), null);
});

test("role-filtered lists never extend one company admin bypass to other companies", () => {
  const value = context("admin", "office");
  assert.deepEqual(companyRoleScope(value, ["admin"]).companyIds, ["A"]);
  const scope = companyRoleScope(value, ["admin", "office"]);
  assert.deepEqual(scope.adminCompanyIds, ["A"]);
  assert.equal(scope.isAdmin, false);
  assert.throws(() => requireCompanyRole(value, "B", ["admin"]), (error) => error.statusCode === 403);
  assert.throws(() => requireLocationAccess(value, "B-unassigned", "B"), (error) => error.statusCode === 403);
  assert.doesNotThrow(() => requireLocationAccess(value, "A-unassigned", "A"));
});

test("target-company projection never broadens already restricted permissions", () => {
  const value = context("admin", "office");
  value.permissions = new Set([PERMISSION.CUSTOMER_DOCUMENT_READ]);
  const scoped = effectiveCompanyContext(value, "B");
  assert.deepEqual([...scoped.permissions], [PERMISSION.CUSTOMER_DOCUMENT_READ]);
  assert.equal(scoped.permissions.has(PERMISSION.WORKORDER_OFFICE), false);
  assert.deepEqual([...value.permissions], [PERMISSION.CUSTOMER_DOCUMENT_READ]);
});

test("admin A cannot bypass mechanic B assignment or location boundaries", async () => {
  const value = context();
  const workorder = { id: "workorder", companyId: "B", locationId: "B-assigned", status: "accepted", mechanicIds: ["other"] };
  const access = (record) => requireWorkorderAccess(value, record.id, { getWorkorder: async () => record, requireLocationMembership: true });
  await assert.rejects(access(workorder), (error) => error.statusCode === 404);
  assert.equal((await access({ ...workorder, mechanicIds: ["user"] })).id, "workorder");
  await assert.rejects(access({ ...workorder, mechanicIds: ["user"], locationId: "B-unassigned" }), (error) => error.statusCode === 404);
  assert.equal((await access({ ...workorder, companyId: "A", locationId: "A-unassigned" })).id, "workorder");
});

test("kiosk role and compatibility internal singleton contexts do not widen tenancy", () => {
  const value = { actor: { id: "user", role: "mechanic" }, sessionMode: "kiosk", companyIds: new Set(["B"]), companyRoles: new Map([["B", "mechanic"]]) };
  assert.equal(effectiveCompanyRole(value, "B"), "mechanic");
  assert.equal(effectiveCompanyRole(value, "A"), null);
  const legacy = { actor: { role: "office" }, companyIds: new Set(["A"]) };
  assert.equal(effectiveCompanyRole(legacy, "A"), "office");
  legacy.companyIds.add("B");
  assert.equal(effectiveCompanyRole(legacy, "A"), null);
});

import assert from "node:assert/strict";
import test from "node:test";
import { resolveRequestContext } from "./context.js";
import { PERMISSION } from "./permissions.js";

const request = { headers: { cookie: "workorder.session_token=test" } };

test("request context is anonymous without a session", async () => {
  const context = await resolveRequestContext(request, {
    headers: new Headers(),
    getSession: async () => null,
    getActor: async () => { throw new Error("actor lookup should not run"); },
  });
  assert.equal(context.actor, null);
  assert.equal(context.permissions.size, 0);
});

test("anonymous request state is isolated per request", async () => {
  const dependencies = {
    headers: new Headers(),
    getSession: async () => null,
  };
  const first = await resolveRequestContext(request, dependencies);
  const second = await resolveRequestContext(request, dependencies);
  first.companyIds.add("company-a");
  assert.equal(second.companyIds.size, 0);
});

test("request context resolves operational actor and memberships", async () => {
  const context = await resolveRequestContext(request, {
    headers: new Headers(),
    getSession: async () => ({ user: { id: "auth-user-1" }, session: { id: "session-1" } }),
    getActor: async (id) => ({
      id: "app-user-1",
      authUserId: id,
      role: "office",
      active: true,
      locationIds: ["location-a", "location-b"],
      companyIds: ["default"],
      companyMemberships: [{ companyId: "default", role: "office" }],
    }),
  });
  assert.equal(context.actor.id, "app-user-1");
  assert.equal(context.permissions.has(PERMISSION.WORKORDER_OFFICE), true);
  assert.deepEqual([...context.locationIds], ["location-a", "location-b"]);
  assert.deepEqual([...context.companyIds], ["default"]);
  assert.equal(context.companyRoles.get("default"), "office");
});

test("inactive operational users cannot become actors", async () => {
  const context = await resolveRequestContext(request, {
    headers: new Headers(),
    getSession: async () => ({ user: { id: "auth-user-1" }, session: { id: "session-1" } }),
    getActor: async () => ({ id: "app-user-1", role: "mechanic", active: false }),
  });
  assert.equal(context.actor, null);
  assert.ok(context.session);
});

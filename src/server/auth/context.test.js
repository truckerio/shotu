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
    getKioskSession: async () => null,
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
  assert.equal(context.sessionMode, "standard");
  assert.equal(context.kiosk, null);
});

test("kiosk companion context narrows a normal Better Auth session to one mechanic location", async () => {
  const context = await resolveRequestContext(request, {
    headers: new Headers(),
    getSession: async () => ({ user: { id: "auth-user-1" }, session: { id: "session-1" } }),
    getActor: async () => ({
      id: "app-user-1",
      authUserId: "auth-user-1",
      role: "admin",
      active: true,
      locationIds: ["location-a", "location-b"],
      companyIds: ["company-a", "company-b"],
      companyMemberships: [
        { companyId: "company-a", role: "admin" },
        { companyId: "company-b", role: "mechanic" },
      ],
    }),
    getKioskSession: async () => ({
      sessionId: "session-1",
      deviceId: "device-1",
      companyId: "company-b",
      locationId: "location-b",
    }),
  });

  assert.equal(context.actor.role, "mechanic");
  assert.equal(context.permissions.has(PERMISSION.WORKORDER_MECHANIC), true);
  assert.equal(context.permissions.has(PERMISSION.ADMIN_MANAGE), false);
  assert.deepEqual([...context.companyIds], ["company-b"]);
  assert.deepEqual([...context.locationIds], ["location-b"]);
  assert.equal(context.sessionMode, "kiosk");
  assert.deepEqual(context.kiosk, { deviceId: "device-1", locationId: "location-b" });
});

test("invalid kiosk companion fails closed instead of becoming a standard full-scope session", async () => {
  const context = await resolveRequestContext(request, {
    headers: new Headers(),
    getSession: async () => ({ user: { id: "auth-user-1" }, session: { id: "session-1" } }),
    getActor: async () => ({
      id: "app-user-1",
      role: "admin",
      active: true,
      locationIds: ["location-a"],
      companyIds: ["company-a"],
      companyMemberships: [{ companyId: "company-a", role: "admin" }],
    }),
    getKioskSession: async () => ({
      sessionId: "session-1",
      deviceId: "device-1",
      companyId: "company-a",
      locationId: "location-a",
      invalid: true,
    }),
  });

  assert.equal(context.actor, null);
  assert.equal(context.permissions.size, 0);
  assert.equal(context.sessionMode, null);
  assert.ok(context.session);
});

test("inactive operational users cannot become actors", async () => {
  const context = await resolveRequestContext(request, {
    headers: new Headers(),
    getSession: async () => ({ user: { id: "auth-user-1" }, session: { id: "session-1" } }),
    getKioskSession: async () => null,
    getActor: async () => ({ id: "app-user-1", role: "mechanic", active: false }),
  });
  assert.equal(context.actor, null);
  assert.ok(context.session);
});

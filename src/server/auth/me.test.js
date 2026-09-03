import assert from "node:assert/strict";
import test from "node:test";
import { handleCurrentUserApi } from "./me.js";

test("GET /api/me returns linked operational actor", async () => {
  let response;
  const handled = await handleCurrentUserApi(
    { method: "GET", headers: {} },
    {},
    new URL("http://localhost/api/me"),
    {
      resolveRequestContext: async () => ({
        sessionMode: "standard",
        kiosk: null,
        actor: {
          id: "app-user-1",
          authUserId: "auth-user-1",
          name: "Office User",
          email: "office@example.com",
          phone: null,
          role: "office",
          active: true,
          locationIds: ["location-a"],
          companyMemberships: [{ companyId: "default", role: "office" }],
        },
      }),
      productModuleBootstrap: async () => ({ version: 1, companies: [] }),
      sendJson: (_res, status, body) => { response = { status, body }; },
    },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.id, "app-user-1");
  assert.equal(response.body.user.authUserId, undefined);
  assert.equal(response.body.sessionMode, "standard");
  assert.deepEqual(response.body.productModuleAccess, { version: 1, companies: [] });
  assert.equal(response.body.kiosk, null);
});

test("GET /api/me exposes minimal kiosk companion context", async () => {
  let response;
  await handleCurrentUserApi(
    { method: "GET", headers: {} },
    {},
    new URL("http://localhost/api/me"),
    {
      resolveRequestContext: async () => ({
        sessionMode: "kiosk",
        kiosk: { deviceId: "device-1", locationId: "location-1" },
        actor: {
          id: "mechanic-1",
          name: "Mechanic One",
          email: "mechanic@example.com",
          phone: null,
          role: "mechanic",
          locationIds: ["location-1"],
          companyMemberships: [{ companyId: "company-1", role: "mechanic" }],
        },
      }),
      productModuleBootstrap: async () => ({ version: 1, companies: [] }),
      sendJson: (_res, status, body) => { response = { status, body }; },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.sessionMode, "kiosk");
  assert.deepEqual(response.body.kiosk, { deviceId: "device-1", locationId: "location-1" });
});

test("/api/auth paths are not claimed by /api/me handler", async () => {
  const handled = await handleCurrentUserApi(
    { method: "GET", headers: {} },
    {},
    new URL("http://localhost/api/auth/me"),
    { sendJson: () => { throw new Error("must not respond"); } },
  );
  assert.equal(handled, false);
});

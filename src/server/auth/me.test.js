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
      sendJson: (_res, status, body) => { response = { status, body }; },
    },
  );
  assert.equal(handled, true);
  assert.equal(response.status, 200);
  assert.equal(response.body.user.id, "app-user-1");
  assert.equal(response.body.user.authUserId, undefined);
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


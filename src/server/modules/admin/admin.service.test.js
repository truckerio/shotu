import assert from "node:assert/strict";
import test from "node:test";
import { createInvitationAuthUser } from "./admin.service.js";

test("invitation acceptance creates credentials through Better Auth admin API", async () => {
  let payload;
  const authApi = {
    async createUser(value) {
      payload = value;
      return { user: { id: "auth-user-1" } };
    },
    signUpEmail() {
      assert.fail("public signup is disabled and must not handle invitations");
    },
  };

  await createInvitationAuthUser({
    authApi,
    invitation: {
      name: "Surveillance User",
      email: "surveillance@example.com",
    },
    input: {
      username: "surveillance1",
      password: "Surveillance@1234",
    },
  });

  assert.deepEqual(payload, {
    body: {
      name: "Surveillance User",
      email: "surveillance@example.com",
      password: "Surveillance@1234",
      role: "user",
      data: {
        username: "surveillance1",
        displayUsername: "surveillance1",
      },
    },
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("invitation acceptance links profiles without conflict-index dependencies", async () => {
  const repository = await readFile(new URL("../../db/repositories/invitations.repo.js", import.meta.url), "utf8");
  const acceptBody = repository.slice(repository.indexOf("export async function acceptUserInvitation"));

  assert.doesNotMatch(acceptBody, /on conflict/i);
  assert.match(acceptBody, /update user_profiles/i);
  assert.match(acceptBody, /insert into user_profiles/i);
  assert.match(acceptBody, /update user_company_memberships/i);
  assert.match(acceptBody, /insert into user_company_memberships/i);
  assert.match(acceptBody, /update user_location_memberships/i);
  assert.match(acceptBody, /insert into user_location_memberships/i);
});

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
  assert.match(acceptBody, /groupedInvitations/i);
  assert.match(acceptBody, /locationIds:/i);
  assert.match(acceptBody, /batch_id is not null and batch_id = \$4/i);
});

test("resending one invitation rotates every token in its durable batch", async () => {
  const repository = await readFile(new URL("../../db/repositories/invitations.repo.js", import.meta.url), "utf8");
  const resendBody = repository.slice(
    repository.indexOf("export async function rotateUserInvitation"),
    repository.indexOf("export async function getInvitationByTokenHash"),
  );
  assert.match(resendBody, /batch_id is not null and batch_id = \$5/i);
  assert.match(resendBody, /md5\(gen_random_uuid\(\)/i);
  assert.doesNotMatch(resendBody, /status = case/i);
});

test("multi-location invitations are persisted as one pending invitation per location", async () => {
  const repository = await readFile(new URL("../../db/repositories/invitations.repo.js", import.meta.url), "utf8");
  const createBody = repository.slice(
    repository.indexOf("export async function createUserInvitations"),
    repository.indexOf("export async function rotateUserInvitation"),
  );
  assert.match(createBody, /for \(const input of inputs\)/);
  assert.match(createBody, /insert into user_invitations/i);
  assert.match(createBody, /await client\.query\("commit"\)/);
});

test("location replacement writes its audit event inside the repository transaction", async () => {
  const repository = await readFile(new URL("../../db/repositories/users.repo.js", import.meta.url), "utf8");
  const replacementBody = repository.slice(
    repository.indexOf("export async function replaceManagedUserLocations"),
    repository.indexOf("export async function listMechanicsByLocations"),
  );
  assert.match(replacementBody, /'locations_updated'/);
  assert.ok(replacementBody.indexOf("'locations_updated'") < replacementBody.indexOf('client.query("commit")'));
  assert.match(replacementBody, /JSON\.stringify\(\{ locationIds \}\)/);
  assert.match(replacementBody, /delete from user_location_memberships/i);
});

test("location user lists hide removed active assignments but retain inactive accounts", async () => {
  const repository = await readFile(new URL("../../db/repositories/users.repo.js", import.meta.url), "utf8");
  const listBody = repository.slice(
    repository.indexOf("export async function listUsersByLocation"),
    repository.indexOf("export async function getManagedUserByCompanies"),
  );
  assert.match(listBody, /membership\.active or not app_user\.active/i);
});

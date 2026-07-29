import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createInvitationAuthUser,
  requestAdminUserPasswordReset,
  resetAdminUserPassword,
} from "./admin.service.js";

const COMPANY_ID = "8f84d529-a70a-4ea4-9c93-70ff7336a756";

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

test("admin invitations create a Better Auth admin identity", async () => {
  let payload;
  await createInvitationAuthUser({
    authApi: { createUser: async (input) => { payload = input; } },
    invitation: {
      name: "Second Admin",
      email: "admin2@example.com",
      role: "admin",
    },
    input: {
      username: "admin2",
      password: "AdminPassword@1234",
    },
  });

  assert.equal(payload.body.role, "admin");
});

test("admin password recovery sends the tenant-scoped user a Better Auth reset email", async () => {
  let request;
  let event;
  const result = await requestAdminUserPasswordReset(
    {
      actor: { id: "admin-1", role: "admin" },
      companyIds: new Set([COMPANY_ID]),
    },
    { id: "admin-1" },
    "user-1",
    { companyId: COMPANY_ID },
    new Headers({ cookie: "session=test" }),
    "https://workorders.example.com",
    {
      getTargets: async () => [{
        id: "user-1",
        company_id: COMPANY_ID,
        active: true,
        company_membership_active: true,
        auth_user_id: "auth-user-1",
        auth_email: "mechanic@example.com",
      }],
      authApi: {
        async requestPasswordReset(input) {
          request = input;
        },
      },
      async recordEvent(input) {
        event = input;
      },
    },
  );

  assert.deepEqual(result, { sent: true });
  assert.deepEqual(request.body, {
    email: "mechanic@example.com",
    redirectTo: "https://workorders.example.com/?resetPassword=1",
  });
  assert.equal(event.companyId, COMPANY_ID);
  assert.equal(event.actorId, "admin-1");
  assert.equal(event.targetUserId, "user-1");
  assert.equal(event.action, "password_reset_requested");
  assert.deepEqual(event.details, { delivery: "email" });
});

test("admin password recovery refuses inactive users before sending email", async () => {
  let called = false;
  await assert.rejects(
    requestAdminUserPasswordReset(
      {
        actor: { id: "admin-1", role: "admin" },
        companyIds: new Set([COMPANY_ID]),
      },
      { id: "admin-1" },
      "user-1",
      { companyId: COMPANY_ID },
      new Headers(),
      "https://workorders.example.com",
      {
        getTargets: async () => [{
          id: "user-1",
          company_id: COMPANY_ID,
          active: false,
          company_membership_active: false,
          auth_user_id: "auth-user-1",
          auth_email: "mechanic@example.com",
        }],
        authApi: {
          async requestPasswordReset() {
            called = true;
          },
        },
      },
    ),
    /Activate this user/,
  );
  assert.equal(called, false);
});

test("admin directly resets a mechanic password, revokes sessions, and audits the action", async () => {
  const calls = [];
  let event;
  const result = await resetAdminUserPassword(
    { companyIds: new Set([COMPANY_ID]) },
    { id: "admin-1" },
    "location-1",
    "mechanic-1",
    { password: "MechanicPassword@1234" },
    new Headers({ cookie: "session=test" }),
    {
      authorizeTarget: async () => ({
        target: {
          id: "mechanic-1",
          role: "mechanic",
          auth_user_id: "auth-mechanic-1",
          company_ids: [COMPANY_ID],
        },
      }),
      authApi: {
        async setUserPassword(input) {
          calls.push(["password", input]);
        },
        async revokeUserSessions(input) {
          calls.push(["sessions", input]);
        },
      },
      async recordEvent(input) {
        event = input;
      },
    },
  );

  assert.deepEqual(result, { reset: true });
  assert.equal(calls[0][0], "password");
  assert.equal(calls[0][1].body.newPassword, "MechanicPassword@1234");
  assert.equal(calls[1][0], "sessions");
  assert.equal(event.action, "password_reset");
  assert.deepEqual(event.details, { sessionsRevoked: true });
});

test("direct admin password reset refuses non-mechanic users", async () => {
  let authCalled = false;
  await assert.rejects(
    resetAdminUserPassword(
      { companyIds: new Set([COMPANY_ID]) },
      { id: "admin-1" },
      "location-1",
      "office-1",
      { password: "OfficePassword@1234" },
      new Headers(),
      {
        authorizeTarget: async () => ({
          target: {
            id: "office-1",
            role: "office",
            auth_user_id: "auth-office-1",
            company_ids: [COMPANY_ID],
          },
        }),
        authApi: {
          async setUserPassword() {
            authCalled = true;
          },
        },
      },
    ),
    /only for mechanics/,
  );
  assert.equal(authCalled, false);
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
  assert.match(acceptBody, /invitation\.role === "admin" \? \[\] : groupedInvitations\.rows/);
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

test("location user lists include company-wide admins without location memberships", async () => {
  const repository = await readFile(new URL("../../db/repositories/users.repo.js", import.meta.url), "utf8");
  const listBody = repository.slice(
    repository.indexOf("export async function listUsersByLocation"),
    repository.indexOf("export async function getManagedUserByCompanies"),
  );
  assert.match(listBody, /company_membership\.role = 'admin'/i);
  assert.match(listBody, /left join user_location_memberships/i);
});

test("location user lists expose safe kiosk PIN status without credential secrets", async () => {
  const repository = await readFile(new URL("../../db/repositories/users.repo.js", import.meta.url), "utf8");
  const listBody = repository.slice(
    repository.indexOf("export async function listUsersByLocation"),
    repository.indexOf("export async function getManagedUserByCompanies"),
  );
  assert.match(listBody, /mechanic_kiosk_credentials kiosk_credential/i);
  assert.match(listBody, /as kiosk_pin_set/i);
  assert.match(listBody, /as kiosk_pin_requires_change/i);
  assert.match(listBody, /as kiosk_pin_updated_at/i);
  assert.doesNotMatch(listBody, /pin_hash/i);
});

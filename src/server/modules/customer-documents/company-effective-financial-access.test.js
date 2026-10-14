import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { readCustomerDocumentProfile, readStaffCustomerDocumentRevision } from "./customer-documents.service.js";
import { readCustomerDocumentReport } from "./customer-document-reports.service.js";
import { emailCustomerDocumentLink } from "./customer-document-email.service.js";
import { readStaffCustomerDocumentChat } from "./customer-document-chat.service.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const SHOP = "33333333-3333-4333-8333-333333333333";
const ID = "44444444-4444-4444-8444-444444444444";
function mixed() {
  return { actor: { id: "user", role: "admin" }, sessionMode: "standard", companyIds: new Set([A, B]),
    companyRoles: new Map([[A, "admin"], [B, "mechanic"]]), locationIds: new Set([SHOP]), permissions: permissionsForRole("admin") };
}

test("financial reads, reports and email deny lower-role company before downstream work", async () => {
  const denied = (error) => error.statusCode === 403;
  await assert.rejects(readCustomerDocumentProfile(mixed(), { companyId: B, locationId: SHOP }, {
    getProfile: async () => assert.fail("denied profile must not be read"),
  }), denied);
  await assert.rejects(readCustomerDocumentReport(mixed(), { companyId: B, locationId: SHOP }, {
    readReport: async () => assert.fail("denied finance report must not run"),
  }), denied);
  await assert.rejects(emailCustomerDocumentLink(mixed(), ID, {
    companyId: B, locationId: SHOP, rawToken: "a".repeat(43), idempotencyKey: "denied-mail-key",
  }, { pool: { connect: async () => assert.fail("denied email must not open a transaction") } }), denied);
});

test("revision lookup filters nonfinancial companies and never broadens admin locations", async () => {
  let queryScope;
  await readStaffCustomerDocumentRevision(mixed(), ID, { readRevision: async (scope) => {
    queryScope = scope; return { id: ID, companyId: A };
  } });
  assert.deepEqual(queryScope.companyIds, [A]);
  assert.deepEqual(queryScope.adminCompanyIds, [A]);
  const office = mixed(); office.companyRoles.set(B, "office");
  await readStaffCustomerDocumentRevision(office, ID, { readRevision: async (scope) => {
    assert.deepEqual(scope.companyIds, [A, B]);
    assert.deepEqual(scope.adminCompanyIds, [A]);
    assert.equal(scope.isAdmin, false);
    return { id: ID, companyId: A };
  } });
});

test("mechanic company discussion projection keeps its effective role", async () => {
  let command;
  const result = await readStaffCustomerDocumentChat(mixed(), ID, { companyId: B, locationId: SHOP, documentId: ID, revisionId: ID }, {
    requireWorkorderAccess: async (scoped) => {
      assert.equal(scoped.actor.role, "mechanic");
      return { id: ID, companyId: B, locationId: SHOP };
    },
    list: async (scope) => { command = scope; return []; },
  });
  assert.equal(command.actorRole, "mechanic");
  assert.deepEqual(result.messages, []);
});

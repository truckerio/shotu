import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import { issueInformationalDraftEstimate } from "./customer-documents.service.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const customerId = "33333333-3333-4333-8333-333333333333";
const contactId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
const profileId = "66666666-6666-4666-8666-666666666666";
const actorId = "77777777-7777-4777-8777-777777777777";

test("default Estimate snapshots selected tenant customer/contact and permits scope-only pricing", async () => {
  const context = {
    actor: { id: actorId, role: "office" },
    companyIds: new Set([companyId]), locationIds: new Set([locationId]),
    permissions: permissionsForRole("office"),
  };
  const draft = {
    id: draftId, companyId, locationId, status: "active", version: 1,
    payload: { formData: { customerAccountId: customerId, customerContactId: contactId,
      customerCompanyName: "Untrusted browser label", unitNo: "Truck 9" } },
  };
  const queries = [];
  const client = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql.includes("customer_directory_customers")) return { rows: [{ id: customerId, name: "Acme Fleet", address: "1 Main St" }] };
    if (sql.includes("customer_directory_contacts")) return { rows: [{ id: contactId, name: "Sam", email: "sam@example.com", phone: "555-0100" }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  let issue;
  await issueInformationalDraftEstimate(context, draft,
    { companyId, locationId, concern: "Inspect", formData: draft.payload.formData }, client, {
      ensureInformationalProfile: async () => ({
        id: profileId, informationalOnly: true, defaultCurrency: "USD",
        shopIdentity: { legalName: "Repair Shop" }, documentTerms: { estimate: "" },
        authorizationText: "Information only.", taxProfileVersionId: null,
      }),
      readCreatePricing: async () => ({ fingerprint: "a".repeat(64) }),
      readCurrentEstimateForUpdate: async () => null,
      issueRevision: async (command) => { issue = command; return { revision: { id: contactId } }; },
    });
  assert.deepEqual(queries.map(({ params }) => params), [
    [companyId, customerId], [companyId, customerId, contactId],
  ]);
  assert.equal(issue.snapshot.customer.company, "Acme Fleet");
  assert.equal(issue.snapshot.customer.name, "Sam");
  assert.equal(issue.snapshot.pricingStatus, "pending");
  assert.equal(issue.snapshot.lines.length, 0);
  assert.equal(issue.recipientSnapshot.email, "sam@example.com");
  assert.equal(issue.recipientSnapshot.customerId, customerId);
  assert.equal(issue.recipientSnapshot.contactId, contactId);
  assert.equal(issue.informationalOnly, true);
});

test("default submission reuses a current manually issued Estimate instead of creating a second document", async () => {
  const context = {
    actor: { id: actorId, role: "office" },
    companyIds: new Set([companyId]), locationIds: new Set([locationId]),
    permissions: permissionsForRole("office"),
  };
  const draft = {
    id: draftId, companyId, locationId, status: "active", version: 4,
    payload: { formData: { customerAccountId: customerId, customerContactId: contactId,
      customerCompanyName: "Untrusted browser label", unitNo: "Truck 9" } },
  };
  const current = {
    id: "88888888-8888-4888-8888-888888888888",
    documentId: "99999999-9999-4999-8999-999999999999",
    snapshot: { sourceEvidence: { kind: "draft", id: draftId, version: 4 } },
    recipientSnapshot: { customerId, contactId, name: "Sam", company: "Acme Fleet",
      address: "1 Main St", email: "sam@example.com", phone: "555-0100" },
  };
  const client = { async query(sql) {
    if (sql.includes("customer_directory_customers")) return { rows: [{ id: customerId, name: "Acme Fleet", address: "1 Main St" }] };
    if (sql.includes("customer_directory_contacts")) return { rows: [{ id: contactId, name: "Sam", email: "sam@example.com", phone: "555-0100" }] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
  const result = await issueInformationalDraftEstimate(context, draft,
    { companyId, locationId, concern: "Inspect", formData: draft.payload.formData }, client, {
      ensureInformationalProfile: async () => ({
        id: profileId, informationalOnly: true, defaultCurrency: "USD",
        shopIdentity: { legalName: "Repair Shop" }, documentTerms: { estimate: "" },
        authorizationText: "Information only.", taxProfileVersionId: null,
      }),
      readCreatePricing: async () => ({ fingerprint: "a".repeat(64) }),
      readCurrentEstimateForUpdate: async () => current,
      issueRevision: async () => assert.fail("a current exact Estimate must be reused"),
    });
  assert.equal(result.replayed, true);
  assert.equal(result.revision.id, current.id);
});

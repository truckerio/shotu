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

function officeContext() {
  return {
    actor: { id: actorId, role: "office" },
    companyIds: new Set([companyId]), locationIds: new Set([locationId]),
    permissions: permissionsForRole("office"),
  };
}

function commercialDraft(adjustments) {
  return {
    id: draftId, companyId, locationId, status: "active", version: 1,
    payload: {
      concern: "Inspect brakes",
      pricing: { parts: [{ partIndex: 0, selection: "selling_price" }] },
      formData: {
        customerCompanyName: "Acme Fleet", unitNo: "Truck 9",
        parts: [{ catalogPartId: customerId, partNo: "BRAKE", qty: "2", uomCode: "ea", repairOrder: "Replace brakes" }],
        customerDocumentAdjustments: adjustments,
      },
    },
  };
}

function commercialProfile(overrides = {}) {
  return {
    id: profileId, informationalOnly: false, defaultCurrency: "USD",
    taxProfileVersionId: contactId,
    taxComponents: [{ name: "Sales tax", rate: "10", compound: false }],
    lineTaxPolicy: { labor: "exclusive", part: "exclusive", shop_supply: "exclusive", fee: "exclusive", core_charge: "exclusive", credit: "out_of_scope" },
    discountPolicy: { maxOfficePercentage: "15", reasonRequired: true },
    shopIdentity: { legalName: "Repair Shop" },
    documentTerms: { estimate: "Estimate terms", warranty: "Warranty", footer: "Footer" },
    authorizationText: "Information only.",
    ...overrides,
  };
}

function commercialPricing(overrides = {}) {
  return {
    fingerprint: "a".repeat(64),
    parts: [{ partIndex: 0, status: "known", price: {
      selection: "selling_price", unitPrice: "100.0000", totalPrice: "200.0000", currency: "USD",
      sellingPolicyVersionId: profileId,
    } }],
    labor: { status: "empty" },
    ...overrides,
  };
}

function customerClient() {
  return { async query(sql) {
    if (sql.includes("customer_directory_customers")) return { rows: [] };
    if (sql.includes("customer_directory_contacts")) return { rows: [] };
    throw new Error(`Unexpected query: ${sql}`);
  } };
}

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

test("direct submission carries a saved discount through the authoritative financial calculator", async () => {
  const adjustments = {
    lineDiscounts: [],
    documentDiscount: { kind: "percentage", value: "10", reason: "Courtesy adjustment" },
    overrideReasons: [],
  };
  const draft = commercialDraft(adjustments);
  let issued;
  await issueInformationalDraftEstimate(officeContext(), draft,
    { companyId, locationId, concern: draft.payload.concern, pricing: draft.payload.pricing, formData: draft.payload.formData }, customerClient(), {
      ensureInformationalProfile: async () => commercialProfile(),
      readCreatePricing: async () => commercialPricing(),
      readCurrentEstimateForUpdate: async () => null,
      issueRevision: async (command) => { issued = command; return { revision: { id: contactId } }; },
    });
  assert.equal(issued.snapshot.totals.subtotal, "200.00");
  assert.equal(issued.snapshot.totals.discountTotal, "20.00");
  assert.equal(issued.snapshot.totals.tax, "18.00");
  assert.equal(issued.snapshot.totals.total, "198.00");
  assert.deepEqual(issued.snapshot.discountEvidence.documentDiscount, adjustments.documentDiscount);
});

test("direct submission rejects saved discounts when commercial pricing or policy validation fails", async () => {
  const adjustments = {
    lineDiscounts: [],
    documentDiscount: { kind: "percentage", value: "10", reason: "Courtesy adjustment" },
    overrideReasons: [],
  };
  const draft = commercialDraft(adjustments);
  const prepared = { companyId, locationId, concern: draft.payload.concern, pricing: draft.payload.pricing, formData: draft.payload.formData };
  const dependencies = {
    ensureInformationalProfile: async () => commercialProfile(),
    readCurrentEstimateForUpdate: async () => null,
    issueRevision: async () => assert.fail("a discounted submission must not fall back to a scope-only Estimate"),
  };
  await assert.rejects(
    issueInformationalDraftEstimate(officeContext(), draft, prepared, customerClient(), {
      ...dependencies,
      readCreatePricing: async () => commercialPricing({ parts: [{ partIndex: 0, status: "known", price: { selection: "unknown", unitPrice: "100", currency: "USD" } }] }),
    }),
    (error) => error.code === "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED",
  );
  await assert.rejects(
    issueInformationalDraftEstimate(officeContext(), draft, prepared, customerClient(), {
      ...dependencies,
      readCreatePricing: async () => commercialPricing(),
      ensureInformationalProfile: async () => commercialProfile({ discountPolicy: { maxOfficePercentage: "5", reasonRequired: true } }),
    }),
    (error) => error.code === "CUSTOMER_DOCUMENT_DISCOUNT_POLICY_DENIED",
  );
});

test("direct submission rejects a saved discount when only an informational profile is available", async () => {
  const draft = commercialDraft({
    lineDiscounts: [],
    documentDiscount: { kind: "fixed", value: "5", reason: "Courtesy adjustment" },
    overrideReasons: [],
  });
  await assert.rejects(
    issueInformationalDraftEstimate(officeContext(), draft,
      { companyId, locationId, concern: draft.payload.concern, pricing: draft.payload.pricing, formData: draft.payload.formData }, customerClient(), {
        ensureInformationalProfile: async () => commercialProfile({ informationalOnly: true }),
        issueRevision: async () => assert.fail("a saved discount requires a commercial profile"),
      }),
    (error) => error.code === "CUSTOMER_DOCUMENT_DISCOUNT_PROFILE_REQUIRED",
  );
});

test("direct submission reports malformed saved discount intent as a bad request", async () => {
  const draft = commercialDraft({ lineDiscounts: [], documentDiscount: { kind: "fixed", value: "5", reason: "x" }, overrideReasons: [] });
  await assert.rejects(
    issueInformationalDraftEstimate(officeContext(), draft,
      { companyId, locationId, concern: draft.payload.concern, pricing: draft.payload.pricing, formData: draft.payload.formData }, customerClient(), {
        ensureInformationalProfile: async () => commercialProfile(),
      }),
    (error) => error.statusCode === 400 && /documentDiscount\.reason/i.test(error.message),
  );
});

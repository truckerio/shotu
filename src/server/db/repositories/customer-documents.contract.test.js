import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalFinancialHash } from "../../modules/customer-documents/customer-financial-calculator.js";
import {
  approvedEstimateMatchesInvoiceReadiness,
  createCustomerDocumentGrant,
  getCustomerDocumentProfileForScope,
  getStaffCustomerDocumentRevision,
  getStaffCurrentEstimateByDraft,
  issueCustomerDocumentRevision,
  resolveCustomerDocumentGrant,
  viewCustomerDocumentGrant,
  customerDocumentSourceLineageMatches,
  activateApprovedEstimate,
} from "./customer-documents.repo.js";

const migrations = new URL("../migrations/", import.meta.url);
const UUID = {
  company: "11111111-1111-4111-8111-111111111111",
  location: "22222222-2222-4222-8222-222222222222",
  actor: "33333333-3333-4333-8333-333333333333",
  profile: "44444444-4444-4444-8444-444444444444",
  tax: "55555555-5555-4555-8555-555555555555",
  series: "66666666-6666-4666-8666-666666666666",
  document: "77777777-7777-4777-8777-777777777777",
  draft: "88888888-8888-4888-8888-888888888888",
  revision: "99999999-9999-4999-8999-999999999999",
  grant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");

test("migrations define permanent independent numbering and immutable tenant-bound evidence", async () => {
  const [profiles, ledger, hardening, taxPolicy, viewAudit, authorization, invoiceIdentity, commercialDefaults] = await Promise.all([
    readFile(new URL("182_customer_document_profiles_and_numbering.sql", migrations), "utf8"),
    readFile(new URL("183_customer_document_ledger_and_grants.sql", migrations), "utf8"),
    readFile(new URL("184_customer_document_integrity_hardening.sql", migrations), "utf8"),
    readFile(new URL("185_customer_document_line_tax_policy.sql", migrations), "utf8"),
    readFile(new URL("186_customer_document_view_audit.sql", migrations), "utf8"),
    readFile(new URL("187_workorder_draft_authorization_classification.sql", migrations), "utf8"),
    readFile(new URL("188_customer_document_invoice_workorder_identity.sql", migrations), "utf8"),
    readFile(new URL("190_customer_document_profile_commercial_defaults.sql", migrations), "utf8"),
  ]);
  assert.match(profiles, /document_type in \('estimate', 'invoice'\)/i);
  assert.match(profiles, /unique \(company_id, document_type\)/i);
  assert.match(profiles, /Published customer document profile versions are immutable/i);
  assert.match(hardening, /Customer document numbers cannot reset or be reused/i);
  assert.match(hardening, /customer_documents_estimate_draft_uidx/i);
  assert.doesNotMatch(`${profiles}\n${ledger}\n${hardening}`, /'receipt'/i);

  assert.match(ledger, /foreign key \(company_id, location_id, document_id, revision_id, revision_hash\)/i);
  assert.match(ledger, /before update or delete on customer_document_revisions/i);
  assert.match(ledger, /before update or delete on customer_document_events/i);
  assert.match(ledger, /where event_type in \('accepted','declined','changes_requested'\)/i);
  assert.match(ledger, /token_hash char\(64\).*\^\[0-9a-f\]\{64\}/is);
  assert.match(ledger, /raw tokens must never be persisted/i);
  assert.match(ledger, /workorderVersion/);
  assert.match(ledger, /reconciliationHash/);
  assert.match(ledger, /authorizationBasis/);
  assert.match(taxPolicy, /line_tax_policy/i);
  assert.match(viewAudit, /new\.event_type in \('viewed','accepted','declined','changes_requested'\)/i);
  assert.match(authorization, /authorization_classification/i);
  assert.match(authorization, /required_external_customer/i);
  assert.match(authorization, /create table workorder_authorization_events/i);
  assert.match(authorization, /Workorder authorization evidence is immutable/i);
  assert.match(invoiceIdentity, /unique index customer_documents_invoice_workorder_uidx/i);
  assert.match(commercialDefaults, /estimate_number_prefix/i);
  assert.match(commercialDefaults, /invoice_number_prefix/i);
  assert.match(commercialDefaults, /estimate_validity_days/i);
});

test("existing documents require exact draft and Workorder lineage", () => {
  assert.equal(customerDocumentSourceLineageMatches(
    { draft_id: UUID.draft, workorder_id: null }, { draftId: UUID.draft, workorderId: null },
  ), true);
  assert.equal(customerDocumentSourceLineageMatches(
    { draft_id: UUID.draft, workorder_id: null }, { draftId: UUID.document, workorderId: null },
  ), false);
  assert.equal(customerDocumentSourceLineageMatches(
    { draft_id: UUID.draft, workorder_id: UUID.document }, { draftId: null, workorderId: UUID.document },
  ), false);
});

test("Invoice readiness accepts an unchanged activation-authorized R1 and rejects forged scope evidence", () => {
  const lines = [{ type: "part", description: "Replace gasket", quantity: "2", unit: "ea", unitPrice: "15.00" }];
  const snapshot = { lines, sourceEvidence: { kind: "draft", pricingFingerprint: hash("draft-pricing") } };
  const scopeHash = canonicalFinancialHash({ lines });
  const readiness = {
    sourceMatchMode: "activation_commercial_scope", actualScopeHash: scopeHash, acceptedScopeHash: scopeHash,
    actualPricingFingerprint: hash("workorder-pricing"),
  };
  assert.equal(approvedEstimateMatchesInvoiceReadiness({ snapshot, activation_authorized: true }, readiness), true);
  assert.equal(approvedEstimateMatchesInvoiceReadiness({ snapshot, activation_authorized: false }, readiness), false);
  assert.equal(approvedEstimateMatchesInvoiceReadiness({ snapshot, activation_authorized: true }, { ...readiness, actualScopeHash: hash("forged") }), false);
});

test("Invoice authorization and Estimate voiding serialize on the immutable Estimate document", async () => {
  const source = await readFile(new URL("customer-documents.repo.js", import.meta.url), "utf8");
  assert.match(source, /getCurrentAcceptedEstimateForWorkorder[\s\S]*for update of document,revision/);
  assert.match(source, /accepted_estimate_revision_id=revision\.id[\s\S]*as activation_authorized/);
  assert.match(source, /workorder_authorization_events auth_event/);
  assert.doesNotMatch(source, /workorder_authorization_events authorization/);
  assert.match(source, /voidCustomerDocumentRevision[\s\S]*for update of document,revision[\s\S]*document_type='invoice'/);
});

test("terminal responses disable response authority without disabling replacement view links", async () => {
  const source = await readFile(new URL("customer-documents.repo.js", import.meta.url), "utf8");
  const grantCreation = source.slice(source.indexOf("export async function createCustomerDocumentGrant"), source.indexOf("export async function recordCustomerDocumentResponse"));
  assert.match(grantCreation, /const responseEligible = revision\.authorization_classification === "required_external_customer"/);
  assert.match(grantCreation, /const actions = \["view_revision"/);
  assert.doesNotMatch(grantCreation, /if \(terminal\) throw domainError\("CUSTOMER_DOCUMENT_REVISION_NOT_RESPONSE_ELIGIBLE"\)/);
});

test("profile scope read returns canonical current tax evidence", async () => {
  let captured;
  const profile = await getCustomerDocumentProfileForScope({ companyId: UUID.company, locationId: UUID.location }, {
    query: async (text, params) => {
      captured = { text, params };
      return { rows: [{
        id: UUID.profile,
        profile_id: UUID.profile,
        company_id: UUID.company,
        location_id: UUID.location,
        version: 2,
        shop_identity: {},
        document_terms: {},
        authorization_text: "Authorize repairs",
        discount_policy: {},
        default_currency: "USD",
        tax_profile_version_id: UUID.tax,
        tax_components: [{ name: "Sales tax", rate: "7.25", compound: false }],
        tax_currency: "USD",
        tax_state: "active",
      }] };
    },
  });
  assert.match(captured.text, /profile\.current_version_id/);
  assert.match(captured.text, /inventory_tax_profile_versions/);
  assert.deepEqual(captured.params, [UUID.company, UUID.location]);
  assert.equal(profile.taxCurrency, "USD");
  assert.equal(profile.taxState, "active");
  assert.equal(profile.taxComponents[0].rate, "7.25");
});

test("staff exact revision read projects accepted response and activation eligibility", async () => {
  const revision = await getStaffCustomerDocumentRevision({
    revisionId: UUID.revision, companyIds: [UUID.company], locationIds: [UUID.location], isAdmin: false,
  }, { query: async () => ({ rows: [{
    id: UUID.revision, company_id: UUID.company, location_id: UUID.location, document_id: UUID.document,
    document_type: "estimate", document_number: "EST-1", revision_number: 1,
    profile_version_id: UUID.profile, snapshot: {}, content_hash: hash("content"),
    financial_fingerprint: hash("financial"), recipient_snapshot: {}, currency: "USD",
    subtotal: "10", discount_total: "0", tax_total: "0", total_amount: "10",
    issued_by_user_id: UUID.actor, issued_at: new Date(), is_latest: true,
    response_event_type: "accepted", response_created_at: new Date("2026-09-28T20:00:00.000Z"),
    response_metadata: { customerName: "Jane" },
  }] }) });
  assert.equal(revision.response.status, "accepted");
  assert.equal(revision.response.customerName, "Jane");
  assert.deepEqual(revision.eligibility, { canRespond: false, canActivate: true });
});

test("staff draft recovery query is exact-company, exact-location, Estimate-only and grant-free", async () => {
  let captured;
  const revision = await getStaffCurrentEstimateByDraft({
    companyId: UUID.company, locationId: UUID.location, draftId: UUID.draft,
  }, { query: async (text, params) => {
    captured = { text, params };
    return { rows: [{
      id: UUID.revision, company_id: UUID.company, location_id: UUID.location, document_id: UUID.document,
      document_type: "estimate", document_number: "EST-1", revision_number: 1,
      profile_version_id: UUID.profile, snapshot: {}, content_hash: hash("content"),
      financial_fingerprint: hash("financial"), recipient_snapshot: {}, currency: "USD",
      subtotal: "10", discount_total: "0", tax_total: "0", total_amount: "10",
      issued_by_user_id: UUID.actor, issued_at: new Date(), is_latest: true,
      response_event_type: "accepted", response_created_at: new Date(), response_metadata: {},
    }] };
  } });
  assert.deepEqual(captured.params, [UUID.company, UUID.location, UUID.draft]);
  assert.match(captured.text, /document\.document_type='estimate'/);
  assert.doesNotMatch(captured.text, /access_grants|token_hash/i);
  assert.equal(revision.eligibility.canActivate, true);
});

function mockPool(handler) {
  const calls = [];
  return {
    calls,
    pool: {
      async connect() {
        return {
          async query(text, params = []) {
            calls.push({ text, params });
            return handler(text, params, calls);
          },
          release() {},
        };
      },
    },
  };
}

test("issuance stamps reserved identity then hashes and stores the exact finalized snapshot", async () => {
  let revisionInsert;
  const issuedAt = new Date("2026-09-28T18:00:00.000Z");
  const { pool } = mockPool(async (text, params) => {
    if (/^(begin|commit|rollback)$/.test(text)) return { rows: [] };
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/from customer_document_revisions revision[\s\S]*idempotency_key=\$3/.test(text)) return { rows: [] };
    if (/select version\.id,profile\.location_id/.test(text)) {
      return { rows: [{ id: UUID.profile, location_id: null, default_currency: "USD", tax_currency: "USD", tax_state: "active", estimate_number_prefix: "Q-", estimate_number_digits: 5, invoice_number_prefix: "BILL-", invoice_number_digits: 7, estimate_validity_days: 14 }] };
    }
    if (/insert into customer_document_number_series/.test(text)) return { rows: [] };
    if (/from workorder_drafts[\s\S]*status='active'/.test(text)) return { rows: [{ id: UUID.draft }] };
    if (/from customer_document_number_series/.test(text)) {
      return { rows: [{ id: UUID.series, company_id: UUID.company, prefix: "EST-", digits: 6, next_number: "12" }] };
    }
    if (/update customer_document_number_series/.test(text)) return { rows: [] };
    if (/insert into customer_documents/.test(text)) {
      return { rows: [{
        id: UUID.document,
        company_id: UUID.company,
        location_id: UUID.location,
        draft_id: UUID.draft,
        workorder_id: null,
        document_type: "estimate",
        document_number: params[7],
      }] };
    }
    if (/select \* from customer_document_revisions/.test(text)) return { rows: [] };
    if (/transaction_timestamp/.test(text)) return { rows: [{ issued_at: issuedAt }] };
    if (/insert into customer_document_revisions/.test(text)) {
      revisionInsert = params;
      return { rows: [{
        id: params[0], company_id: params[1], location_id: params[2], document_id: params[3],
        revision_number: params[4], predecessor_revision_id: params[5], profile_version_id: params[6],
        snapshot: JSON.parse(params[7]), content_hash: params[8], financial_fingerprint: params[9],
        recipient_snapshot: JSON.parse(params[10]), currency: params[11], subtotal: params[12],
        discount_total: params[13], tax_total: params[14], total_amount: params[15],
        invoice_readiness: null, approved_estimate_revision_id: null, issued_by_user_id: params[18],
        issued_at: params[19], request_hash: params[21],
      }] };
    }
    if (/insert into customer_document_events/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const fingerprint = hash("financial");
  const inputSnapshot = {
    document: { id: null, revisionId: null, type: "estimate", number: null, revision: null, state: "draft_projection", issuedAt: null },
    totals: { currency: "USD", subtotal: "100.00", discountTotal: "5.00", tax: "7.00", total: "102.00" },
    financialFingerprint: fingerprint,
  };
  const result = await issueCustomerDocumentRevision({
    companyId: UUID.company,
    locationId: UUID.location,
    draftId: UUID.draft,
    documentType: "estimate",
    profileVersionId: UUID.profile,
    snapshot: inputSnapshot,
    financialFingerprint: fingerprint,
    recipientSnapshot: { name: "Customer", channel: "copy_link" },
    currency: "USD",
    subtotal: "100.00",
    discountTotal: "5.00",
    taxTotal: "7.00",
    totalAmount: "102.00",
    actorId: UUID.actor,
    idempotencyKey: "issue-estimate-12",
    requestHash: hash("issue-estimate-12"),
  }, { pool });

  const storedSnapshot = JSON.parse(revisionInsert[7]);
  assert.equal(storedSnapshot.document.id, UUID.document);
  assert.equal(storedSnapshot.document.revisionId, result.revision.id);
  assert.equal(storedSnapshot.document.number, "Q-00012");
  assert.equal(storedSnapshot.document.revision, 1);
  assert.equal(storedSnapshot.document.state, "issued");
  assert.equal(storedSnapshot.document.issuedAt, issuedAt.toISOString());
  assert.equal(storedSnapshot.document.expiresAt, "2026-10-12T18:00:00.000Z");
  assert.equal(revisionInsert[8], canonicalFinancialHash(storedSnapshot));
  assert.deepEqual(result.revision.snapshot, storedSnapshot);
  assert.equal(result.revision.contentHash, revisionInsert[8]);
  assert.equal(inputSnapshot.document.state, "draft_projection", "caller snapshot remains unmodified");
});

test("Invoice reservation uses the published Invoice policy and never receives Estimate expiry", async () => {
  let revisionInsert;
  const issuedAt = new Date("2026-09-28T18:00:00.000Z");
  const { pool } = mockPool(async (text, params) => {
    if (/^(begin|commit|rollback)$/.test(text)) return { rows: [] };
    if (/pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/from customer_document_revisions revision[\s\S]*idempotency_key=\$3/.test(text)) return { rows: [] };
    if (/select version\.id,profile\.location_id/.test(text)) return { rows: [{ id: UUID.profile, location_id: null, default_currency: "USD", tax_currency: "USD", tax_state: "active", estimate_number_prefix: "Q-", estimate_number_digits: 5, invoice_number_prefix: "BILL-", invoice_number_digits: 7, estimate_validity_days: 14 }] };
    if (/from customer_documents[\s\S]*document_type='invoice'/.test(text)) return { rows: [] };
    if (/from operational_workorders/.test(text)) return { rows: [{ id: UUID.document, status: "mechanic_done", progress_version: 7 }] };
    if (/insert into customer_document_number_series/.test(text)) return { rows: [] };
    if (/from customer_document_number_series/.test(text)) return { rows: [{ id: UUID.series, company_id: UUID.company, prefix: "BILL-", digits: 7, next_number: "12" }] };
    if (/update customer_document_number_series/.test(text)) return { rows: [] };
    if (/insert into customer_documents/.test(text)) return { rows: [{ id: UUID.document, company_id: UUID.company, location_id: UUID.location, draft_id: null, workorder_id: UUID.draft, document_type: "invoice", document_number: params[7] }] };
    if (/select \* from customer_document_revisions/.test(text)) return { rows: [] };
    if (/transaction_timestamp/.test(text)) return { rows: [{ issued_at: issuedAt }] };
    if (/insert into customer_document_revisions/.test(text)) { revisionInsert = params; return { rows: [{ id: params[0], company_id: params[1], location_id: params[2], document_id: params[3], revision_number: params[4], predecessor_revision_id: params[5], profile_version_id: params[6], snapshot: JSON.parse(params[7]), content_hash: params[8], financial_fingerprint: params[9], recipient_snapshot: JSON.parse(params[10]), currency: params[11], subtotal: params[12], discount_total: params[13], tax_total: params[14], total_amount: params[15], invoice_readiness: JSON.parse(params[16]), approved_estimate_revision_id: null, issued_by_user_id: params[18], issued_at: params[19], request_hash: params[21] }] }; }
    if (/insert into customer_document_events/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const fingerprint = hash("invoice-financial");
  await issueCustomerDocumentRevision({
    companyId: UUID.company, locationId: UUID.location, workorderId: UUID.draft, documentType: "invoice", profileVersionId: UUID.profile,
    snapshot: { document: { type: "invoice", state: "draft_projection", expiresAt: "client-controlled" }, totals: { currency: "USD", subtotal: "100.00", discountTotal: "0.00", tax: "0.00", total: "100.00" }, financialFingerprint: fingerprint },
    financialFingerprint: fingerprint, recipientSnapshot: { name: "Customer", channel: "link" }, currency: "USD", subtotal: "100.00", discountTotal: "0.00", taxTotal: "0.00", totalAmount: "100.00",
    invoiceReadiness: { workorderVersion: 7, reconciliationHash: hash("reconciliation"), actualPricingFingerprint: hash("pricing"), authorizationBasis: "manual" }, actorId: UUID.actor, idempotencyKey: "issue-invoice-12", requestHash: hash("issue-invoice-12"),
  }, { pool });
  const storedSnapshot = JSON.parse(revisionInsert[7]);
  assert.equal(storedSnapshot.document.number, "BILL-0000012");
  assert.equal(storedSnapshot.document.expiresAt, null);
});

test("grant creation persists only a digest and raw token is returned only at creation", async () => {
  const rawToken = "customer-document-token-that-is-at-least-thirty-two-bytes";
  let grantInsertParams;
  const revision = {
    id: UUID.revision,
    company_id: UUID.company,
    location_id: UUID.location,
    document_id: UUID.document,
    document_type: "estimate",
    authorization_classification: "required_external_customer",
    workorder_id: null,
    content_hash: hash("content"),
  };
  const { pool, calls } = mockPool(async (text, params) => {
    if (/^(begin|commit|rollback)$/.test(text) || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/from customer_document_access_grants[\s\S]*issued_by_user_id/.test(text)) return { rows: [] };
    if (/from customer_document_revisions revision/.test(text)) return { rows: [revision] };
    if (/from customer_document_events/.test(text)) return { rows: [] };
    if (/select id from customer_document_revisions/.test(text)) return { rows: [{ id: UUID.revision }] };
    if (/insert into customer_document_access_grants/.test(text)) {
      grantInsertParams = params;
      return { rows: [{
        id: UUID.grant, company_id: UUID.company, location_id: UUID.location,
        document_id: UUID.document, revision_id: UUID.revision, token_hint: rawToken.slice(-8),
        allowed_actions: ["view_revision", "respond_revision"], workorder_id: null,
        issued_at: new Date(), expires_at: new Date(Date.now() + 60_000),
      }] };
    }
    if (/insert into customer_document_events/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const result = await createCustomerDocumentGrant({
    companyId: UUID.company,
    locationId: UUID.location,
    revisionId: UUID.revision,
    allowedActions: ["view_revision", "respond_revision"],
    expiresAt: new Date(Date.now() + 60_000),
    actorId: UUID.actor,
    idempotencyKey: "grant-estimate-12",
    requestHash: hash("grant-estimate-12"),
  }, { pool, tokenFactory: () => rawToken });
  assert.equal(result.rawToken, rawToken);
  assert.equal(grantInsertParams[4], hash(rawToken));
  assert.equal(grantInsertParams[5], rawToken.slice(-8));
  assert.deepEqual(grantInsertParams[6], ["view_revision", "respond_revision"]);
  assert.equal(calls.some(({ params }) => params.some((value) => value === rawToken)), false);
});

test("grant capabilities are derived from canonical approval and Workorder state", async () => {
  async function derivedActions({ classification, workorderId, documentType = "estimate", terminal = null }) {
    let insertedActions;
    const revision = {
      id: UUID.revision, company_id: UUID.company, location_id: UUID.location,
      document_id: UUID.document, document_type: documentType,
      authorization_classification: classification, workorder_id: workorderId,
      content_hash: hash("derived-content"),
    };
    const { pool } = mockPool(async (text, params) => {
      if (/^(begin|commit|rollback)$/.test(text) || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
      if (/from customer_document_access_grants[\s\S]*issued_by_user_id/.test(text)) return { rows: [] };
      if (/from customer_document_revisions revision/.test(text)) return { rows: [revision] };
      if (/select event_type from customer_document_events/.test(text)) return { rows: terminal ? [{ event_type: terminal }] : [] };
      if (/select id from customer_document_revisions/.test(text)) return { rows: [{ id: UUID.revision }] };
      if (/insert into customer_document_access_grants/.test(text)) {
        insertedActions = params[6];
        return { rows: [{
          id: UUID.grant, company_id: UUID.company, location_id: UUID.location,
          document_id: UUID.document, revision_id: UUID.revision, token_hint: "12345678",
          allowed_actions: insertedActions, workorder_id: params[7], issued_at: new Date(),
          expires_at: new Date(Date.now() + 60_000),
        }] };
      }
      if (/insert into customer_document_events/.test(text)) return { rows: [] };
      throw new Error(`Unexpected SQL: ${text}`);
    });
    await createCustomerDocumentGrant({
      companyId: UUID.company, locationId: UUID.location, revisionId: UUID.revision,
      allowedActions: ["view_revision", "respond_revision", "customer_chat"],
      expiresAt: new Date(Date.now() + 60_000), actorId: UUID.actor,
      idempotencyKey: `grant-derived-${classification}-${workorderId || "draft"}-${terminal || "open"}`,
      requestHash: hash(`grant-derived-${classification}-${workorderId || "draft"}-${terminal || "open"}`),
    }, { pool, tokenFactory: () => "D".repeat(43) });
    return insertedActions;
  }

  await assert.rejects(
    derivedActions({ classification: "approval_not_required", workorderId: null }),
    (error) => error.code === "CUSTOMER_DOCUMENT_GRANT_NOT_READY",
  );
  assert.deepEqual(await derivedActions({ classification: "approval_not_required", workorderId: UUID.draft }), ["view_revision", "customer_chat"]);
  assert.deepEqual(await derivedActions({ classification: "required_external_customer", workorderId: null }), ["view_revision", "respond_revision"]);
  assert.deepEqual(await derivedActions({ classification: "required_external_customer", workorderId: UUID.draft, terminal: "accepted" }), ["view_revision", "customer_chat"]);
});

test("grant resolution hashes raw input and returns the exact immutable revision", async () => {
  const rawToken = "another-customer-document-token-with-enough-entropy";
  let captured;
  const result = await resolveCustomerDocumentGrant({ rawToken, capability: "view_revision" }, {
    query: async (text, params) => {
      captured = { text, params };
      return { rows: [{
        id: UUID.revision,
        company_id: UUID.company,
        location_id: UUID.location,
        document_id: UUID.document,
        document_type: "estimate",
        document_number: "EST-000012",
        revision_number: 1,
        profile_version_id: UUID.profile,
        snapshot: {},
        content_hash: hash("content"),
        financial_fingerprint: hash("financial"),
        recipient_snapshot: {},
        currency: "USD",
        subtotal: "100.0000",
        discount_total: "5.0000",
        tax_total: "7.0000",
        total_amount: "102.0000",
        issued_by_user_id: UUID.actor,
        issued_at: new Date(),
        grant_id: UUID.grant,
        token_hint: rawToken.slice(-8),
        allowed_actions: ["view_revision"],
        grant_expires_at: new Date(Date.now() + 60_000),
      }] };
    },
  });
  assert.equal(captured.params[0], hash(rawToken));
  assert.equal(captured.text.includes(rawToken), false);
  assert.equal(result.grant.id, UUID.grant);
  assert.equal(result.revision.id, UUID.revision);
});

test("portal view atomically records exact-revision evidence and advances grant last-used", async () => {
  const rawToken = "portal-view-token-with-more-than-thirty-two-bytes";
  const contentHash = hash("view-content");
  const grant = {
    id: UUID.grant, company_id: UUID.company, location_id: UUID.location,
    document_id: UUID.document, revision_id: UUID.revision,
    token_hint: rawToken.slice(-8), allowed_actions: ["view_revision"],
    expires_at: new Date(Date.now() + 60_000), revoked_at: null,
  };
  const revision = {
    ...grant, id: UUID.revision, grant_id: UUID.grant, revision_number: 1,
    document_type: "estimate", document_number: "EST-000012", profile_version_id: UUID.profile,
    snapshot: {}, content_hash: contentHash, financial_fingerprint: hash("financial"),
    recipient_snapshot: {}, currency: "USD", subtotal: "100.0000", discount_total: "0.0000",
    tax_total: "7.0000", total_amount: "107.0000", issued_by_user_id: UUID.actor,
    issued_at: new Date(), grant_expires_at: grant.expires_at,
  };
  const { pool, calls } = mockPool(async (text) => {
    if (/^(begin|commit|rollback)$/.test(text)) return { rows: [] };
    if (/where token_hash=\$1 for update/.test(text)) return { rows: [grant] };
    if (/from customer_document_events/.test(text)) return { rows: [] };
    if (/from customer_document_access_grants grant_row/.test(text)) return { rows: [revision] };
    if (/insert into customer_document_events/.test(text)) return { rows: [] };
    if (/update customer_document_access_grants set last_used_at/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const result = await viewCustomerDocumentGrant({
    rawToken, idempotencyKey: "view-request-001", requestHash: hash("view-request-001"),
  }, { pool });
  assert.equal(result.revision.id, UUID.revision);
  assert.equal(calls.some(({ text }) => /'viewed'/.test(text)), true);
  assert.equal(calls.some(({ text }) => /last_used_at=now\(\)/.test(text)), true);
  assert.equal(calls.some(({ params }) => params.includes(rawToken)), false);
});

test("portal polling reuses first-view evidence and only advances grant last-used", async () => {
  const rawToken = "portal-poll-token-with-more-than-thirty-two-bytes";
  const grant = {
    id: UUID.grant, company_id: UUID.company, location_id: UUID.location,
    document_id: UUID.document, revision_id: UUID.revision,
    allowed_actions: ["view_revision"], expires_at: new Date(Date.now() + 60_000), revoked_at: null,
  };
  const revision = {
    ...grant, id: UUID.revision, grant_id: UUID.grant, revision_number: 1,
    document_type: "estimate", document_number: "EST-1", profile_version_id: UUID.profile,
    snapshot: {}, content_hash: hash("content"), financial_fingerprint: hash("financial"),
    recipient_snapshot: {}, currency: "USD", subtotal: "1", discount_total: "0", tax_total: "0",
    total_amount: "1", issued_by_user_id: UUID.actor, issued_at: new Date(),
  };
  let inserts = 0;
  const { pool } = mockPool(async (text) => {
    if (/^(begin|commit|rollback)$/.test(text)) return { rows: [] };
    if (/where token_hash=\$1 for update/.test(text)) return { rows: [grant] };
    if (/event_type='viewed'/.test(text)) return { rows: [{ id: "viewed" }] };
    if (/from customer_document_access_grants grant_row/.test(text)) return { rows: [revision] };
    if (/event_type in \('accepted'/.test(text)) return { rows: [] };
    if (/insert into customer_document_events/.test(text)) { inserts += 1; return { rows: [] }; }
    if (/update customer_document_access_grants set last_used_at/.test(text)) return { rows: [] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const result = await viewCustomerDocumentGrant({
    rawToken, idempotencyKey: "poll-request-001", requestHash: hash("poll-request-001"),
  }, { pool });
  assert.equal(result.replayed, true);
  assert.equal(inserts, 0);
});

test("accepted activation submits the exact draft revision and binds the created Workorder", async () => {
  const workorderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  let submitInput;
  const revision = {
    id: UUID.revision, company_id: UUID.company, location_id: UUID.location,
    document_id: UUID.document, document_type: "estimate", draft_id: UUID.draft,
    workorder_id: null, content_hash: hash("accepted"),
    snapshot: { sourceEvidence: { kind: "draft", id: UUID.draft, version: 3, pricingFingerprint: hash("pricing") } },
  };
  const { pool, calls } = mockPool(async (text) => {
    if (/^(begin|commit|rollback)$/.test(text) || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/from customer_document_events[\s\S]*actor_user_id/.test(text)) return { rows: [] };
    if (/from customer_document_revisions revision[\s\S]*for update of document,revision/.test(text)) return { rows: [revision] };
    if (/select id from customer_document_revisions/.test(text)) return { rows: [{ id: UUID.revision }] };
    if (/select event_type from customer_document_events/.test(text)) return { rows: [{ event_type: "accepted" }] };
    if (/update customer_documents set workorder_id/.test(text)) return { rows: [] };
    if (/insert into customer_document_events/.test(text)) return { rows: [{ id: UUID.grant }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  const result = await activateApprovedEstimate({
    companyId: UUID.company, locationId: UUID.location, revisionId: UUID.revision,
    expectedDraftVersion: 3, actorId: UUID.actor, activationPolicy: "accepted_customer_estimate_v1",
    idempotencyKey: "activate-contract-001", requestHash: hash("activate-contract-001"),
  }, async (input) => (submitInput = input, { workorderId }), { pool });
  assert.equal(submitInput.draftId, UUID.draft);
  assert.equal(submitInput.acceptedEstimateRevisionId, UUID.revision);
  assert.equal(result.workorderId, workorderId);
  assert.equal(calls.some(({ text }) => /update customer_documents set workorder_id/.test(text)), true);
});

test("accepted document A cannot activate source draft B", async () => {
  const { pool } = mockPool(async (text) => {
    if (/^(begin|commit|rollback)$/.test(text) || /pg_advisory_xact_lock/.test(text)) return { rows: [] };
    if (/from customer_document_events[\s\S]*actor_user_id/.test(text)) return { rows: [] };
    if (/from customer_document_revisions revision[\s\S]*for update of document,revision/.test(text)) return { rows: [{
      id: UUID.revision, company_id: UUID.company, location_id: UUID.location,
      document_id: UUID.document, document_type: "estimate", draft_id: UUID.draft,
      workorder_id: null, content_hash: hash("accepted"),
      snapshot: { sourceEvidence: { kind: "draft", id: UUID.document, version: 3, pricingFingerprint: hash("pricing") } },
    }] };
    throw new Error(`Unexpected SQL: ${text}`);
  });
  await assert.rejects(activateApprovedEstimate({
    companyId: UUID.company, locationId: UUID.location, revisionId: UUID.revision,
    expectedDraftVersion: 3, actorId: UUID.actor, activationPolicy: "accepted_customer_estimate_v1",
    idempotencyKey: "activate-wrong-source", requestHash: hash("activate-wrong-source"),
  }, async () => assert.fail("mismatched source must not submit"), { pool }),
  (error) => error.code === "CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY");
});

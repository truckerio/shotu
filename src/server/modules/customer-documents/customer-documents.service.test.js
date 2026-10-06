import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRole } from "../../auth/permissions.js";
import {
  activateApprovedCustomerEstimate,
  createCustomerDocumentGrant,
  issueCustomerDocument,
  previewCustomerDocument,
  readCustomerPortalDocument,
  readStaffCurrentEstimateByDraft,
  readCustomerDocumentWorkorderSummary,
  respondToCustomerDocument,
} from "./customer-documents.service.js";
import { WORKORDER_ACTIVATION_POLICY } from "../../../../shared/customer-document-contract.js";

const companyId = "11111111-1111-4111-8111-111111111111";
const locationId = "22222222-2222-4222-8222-222222222222";
const profileId = "33333333-3333-4333-8333-333333333333";
const taxId = "44444444-4444-4444-8444-444444444444";
const draftId = "55555555-5555-4555-8555-555555555555";
const revisionId = "66666666-6666-4666-8666-666666666666";
const workorderId = "88888888-8888-4888-8888-888888888888";

function context(role = "office") {
  return {
    actor: { id: "77777777-7777-4777-8777-777777777777", role },
    companyIds: new Set([companyId]),
    locationIds: new Set([locationId]),
    permissions: permissionsForRole(role),
  };
}

function profile() {
  return {
    id: profileId,
    profileVersionId: profileId,
    defaultCurrency: "USD",
    taxProfileVersionId: taxId,
    taxCurrency: "USD",
    taxComponents: [{ name: "Sales tax", rate: "10", compound: false }],
    shopIdentity: { legalName: "Trusted Repair", phone: "555-0100" },
    documentTerms: { estimate: "Estimate terms", invoice: "Invoice terms", warranty: "Warranty", footer: "Footer" },
    authorizationText: "Authorize this exact revision.",
    discountPolicy: { maxOfficePercentage: "10", reasonRequired: true },
    lineTaxPolicy: { labor: "exclusive", part: "exclusive", shop_supply: "exclusive", fee: "exclusive", core_charge: "exclusive", credit: "out_of_scope" },
  };
}

function projection(type = "estimate") {
  return {
    document: { type, state: "draft_projection" },
    shop: { legalName: "Client-authored shop" },
    customer: { name: "Customer", company: null, address: null, email: null, phone: null },
    unit: { label: "Unit 42" },
    concern: "Brake concern",
    repairDescription: "Replace chamber",
    terms: "client terms",
    authorizationText: "client auth",
    warrantyText: "client warranty",
    footer: "client footer",
    profileVersionId: profileId,
    templateVersion: "customer-document-v1",
    taxProfileVersionId: taxId,
    sourceEvidence: { kind: "draft", id: draftId, version: 1, pricingFingerprint: "a".repeat(64) },
    discountEvidence: { documentDiscount: null },
    financial: {
      currency: "USD",
      basis: type === "invoice" ? "actual" : "estimated",
      lines: [{
        id: "labor-1", type: "labor", description: "Labor", quantity: "2", unit: "hr",
        unitPrice: "100", priceBasis: "selling_price", taxCategory: "labor",
        taxTreatment: "exclusive", taxComponents: [{ name: "Invented", rate: "99", compound: false }],
        discountEligible: true, source: { kind: "labor_product", id: "labor-1" },
      }],
    },
  };
}

function workorderProjection(type = "estimate", pricingFingerprint = "c".repeat(64)) {
  const value = projection(type);
  value.sourceEvidence = { kind: "workorder", id: workorderId, version: 7, pricingFingerprint };
  value.customer = { name: "Workorder Customer", company: "Workorder Customer", address: null, email: null, phone: null };
  return value;
}

test("preview uses published shop, terms, currency, and tax components instead of client copies", async () => {
  const result = await previewCustomerDocument(context(), {
    companyId, locationId, source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
  }, {
    getProfile: async () => profile(),
    buildSource: async () => projection(),
  });
  assert.equal(result.projection.shop.legalName, "Trusted Repair");
  assert.equal(result.projection.terms, "Estimate terms");
  assert.equal(result.projection.lines[0].taxComponents[0].name, "Sales tax");
  assert.equal(result.projection.lines[0].tax, "20.00");
  assert.equal(result.projection.totals.total, "220.00");
});

test("issue persists only the server-calculated projection and hashes the idempotent command", async () => {
  let received;
  const preview = await previewCustomerDocument(context(), {
    companyId, locationId, source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
  }, { getProfile: async () => profile(), buildSource: async () => projection() });
  const result = await issueCustomerDocument(context(), {
    companyId, locationId, documentType: "estimate", draftId,
    source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
    expectedFinancialFingerprint: preview.projection.financialFingerprint,
    recipient: { name: "Jane Customer", company: null, address: null, email: null, phone: null, channel: "link" },
    idempotencyKey: "estimate-issue-001",
  }, {
    getProfile: async () => profile(),
    buildSource: async () => projection(),
    runIssueTransaction: async (work) => work(null),
    issueRevision: async (command) => (received = command, { revision: { id: revisionId } }),
  });
  assert.equal(result.revision.id, revisionId);
  assert.equal(received.snapshot.shop.legalName, "Trusted Repair");
  assert.equal(received.snapshot.customer.name, "Jane Customer");
  assert.equal(received.totalAmount, "220.00");
  assert.match(received.contentHash, /^[0-9a-f]{64}$/);
  assert.match(received.requestHash, /^[0-9a-f]{64}$/);
});

test("Invoice preview and issue require mechanic-done actuals matching the current accepted revised Estimate", async () => {
  const client = { query: async (sql) => {
    if (/select id,company_id,location_id,status,progress_version/.test(sql)) {
      return { rows: [{ id: workorderId, company_id: companyId, location_id: locationId, status: "mechanic_done", progress_version: 7 }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const tx = async (work) => work(client);
  const buildSource = async (_context, _source, _adjustments, _profile, dependencies) => workorderProjection(dependencies.documentType);
  const estimate = await previewCustomerDocument(context(), {
    companyId, locationId, documentType: "estimate",
    source: { kind: "workorder", id: workorderId, expectedVersion: 7 }, adjustments: {},
  }, {
    getProfile: async () => profile(), buildSource, runIssueTransaction: tx,
    readAcceptedEstimate: async () => null,
  });
  const accepted = {
    id: revisionId,
    documentId: draftId,
    documentNumber: "EST-000001",
    revisionNumber: 2,
    snapshot: estimate.projection,
  };
  const preview = await previewCustomerDocument(context(), {
    companyId, locationId, documentType: "invoice",
    source: { kind: "workorder", id: workorderId, expectedVersion: 7 }, adjustments: {},
  }, {
    getProfile: async () => profile(), buildSource, runIssueTransaction: tx,
    readAcceptedEstimate: async () => accepted,
  });
  assert.equal(preview.projection.document.type, "invoice");
  assert.equal(preview.projection.basis, "actual");
  assert.equal(preview.reconciliation.invoiceEligible, true);

  let command;
  await issueCustomerDocument(context(), {
    companyId, locationId, documentType: "invoice", workorderId,
    source: { kind: "workorder", id: workorderId, expectedVersion: 7 }, adjustments: {},
    expectedFinancialFingerprint: preview.projection.financialFingerprint,
    expectedReconciliationHash: preview.reconciliation.reconciliationHash,
    recipient: { channel: "link" }, idempotencyKey: "invoice-issue-service-001",
  }, {
    getProfile: async () => profile(), buildSource, runIssueTransaction: tx,
    readAcceptedEstimate: async () => accepted,
    issueRevision: async (input) => (command = input, { revision: { id: "invoice" } }),
  });
  assert.equal(command.invoiceReadiness.workorderVersion, 7);
  assert.equal(command.approvedEstimateRevisionId, revisionId);
  assert.equal(command.invoiceReadiness.actualPricingFingerprint, "c".repeat(64));
  assert.equal(command.invoiceReadiness.sourceMatchMode, "workorder_pricing_fingerprint");

  await assert.rejects(previewCustomerDocument(context(), {
    companyId, locationId, documentType: "invoice",
    source: { kind: "workorder", id: workorderId, expectedVersion: 7 }, adjustments: {},
  }, {
    getProfile: async () => profile(), buildSource, runIssueTransaction: tx,
    readAcceptedEstimate: async () => ({ ...accepted, snapshot: { ...accepted.snapshot, sourceEvidence: { ...accepted.snapshot.sourceEvidence, pricingFingerprint: "d".repeat(64) } } }),
  }), (error) => error.code === "CUSTOMER_DOCUMENT_INVOICE_NOT_READY");
});

test("Invoice commands reject ad-hoc financial adjustments and reuse accepted Estimate terms", async () => {
  const adjustments = {
    lineDiscounts: [],
    documentDiscount: { kind: "fixed", value: "5.00", reason: "Unapproved invoice discount" },
    overrideReasons: [],
  };
  await assert.rejects(
    previewCustomerDocument(context(), {
      companyId, locationId, documentType: "invoice",
      source: { kind: "workorder", id: workorderId, expectedVersion: 7 }, adjustments,
    }),
    (error) => error?.issues?.some((issue) => issue.path?.[0] === "adjustments"),
  );
  await assert.rejects(
    issueCustomerDocument(context(), {
      companyId, locationId, documentType: "invoice", workorderId,
      source: { kind: "workorder", id: workorderId, expectedVersion: 7 }, adjustments,
      expectedFinancialFingerprint: "a".repeat(64), expectedReconciliationHash: "b".repeat(64),
      recipient: { channel: "link" }, idempotencyKey: "invoice-adjustments-denied",
    }),
    (error) => error?.issues?.some((issue) => issue.path?.[0] === "adjustments"),
  );
});

test("link issuance inherits trusted source customer identity and rejects a truly blank recipient", async () => {
  const preview = await previewCustomerDocument(context(), {
    companyId, locationId, source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
  }, { getProfile: async () => profile(), buildSource: async () => projection() });
  let received;
  await issueCustomerDocument(context(), {
    companyId, locationId, documentType: "estimate", draftId,
    source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
    expectedFinancialFingerprint: preview.projection.financialFingerprint,
    recipient: { channel: "link" }, idempotencyKey: "estimate-recipient-001",
  }, { getProfile: async () => profile(), buildSource: async () => projection(), runIssueTransaction: async (work) => work(null),
    issueRevision: async (command) => (received = command, { revision: { id: revisionId } }) });
  assert.equal(received.recipientSnapshot.name, "Customer");

  const blank = projection(); blank.customer = { name: null, company: null, address: null, email: null, phone: null };
  await assert.rejects(issueCustomerDocument(context(), {
    companyId, locationId, documentType: "estimate", draftId,
    source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
    expectedFinancialFingerprint: preview.projection.financialFingerprint,
    recipient: { channel: "link" }, idempotencyKey: "estimate-recipient-002",
  }, { getProfile: async () => profile(), buildSource: async () => blank, runIssueTransaction: async (work) => work(null) }),
  (error) => error.code === "CUSTOMER_DOCUMENT_RECIPIENT_REQUIRED");
});

test("mechanic cannot preview and invalid grant expiry never reaches persistence", async () => {
  await assert.rejects(
    previewCustomerDocument(context("mechanic"), {
      companyId, locationId, source: { kind: "draft", id: draftId, expectedVersion: 1 }, adjustments: {},
    }, { getProfile: async () => assert.fail() }),
    (error) => error.statusCode === 403,
  );
  await assert.rejects(
    createCustomerDocumentGrant(context(), {
      companyId, locationId, revisionId, allowedActions: ["view_revision"],
      expiresAt: new Date(Date.now() + 60_000).toISOString(), idempotencyKey: "grant-create-001",
    }, { issueGrant: async () => assert.fail() }),
    (error) => error.code === "CUSTOMER_DOCUMENT_GRANT_EXPIRY_INVALID",
  );
});

test("portal passes the raw token only to the hashed repository boundary and returns exact snapshot", async () => {
  const rawToken = "A".repeat(43);
  let received;
  const snapshot = {
    schemaVersion: 1,
    document: { id: "FORBIDDEN-DOCUMENT-ID", revisionId: "FORBIDDEN-REVISION-ID", type: "estimate", number: "EST-1", revision: 1, state: "issued" },
    shop: { legalName: "Shop" }, customer: { name: "Customer" }, unit: { id: "FORBIDDEN-ASSET-ID", label: "Truck" },
    lines: [{ id: "FORBIDDEN-LINE-ID", type: "part", description: "Part", quantity: "1", unit: "ea", unitPrice: "10.00", source: { id: "FORBIDDEN-SOURCE", pricingFingerprint: "FORBIDDEN-FINGERPRINT", overrideReason: "FORBIDDEN-REASON" }, total: "10.00" }],
    sourceEvidence: { id: "FORBIDDEN-SOURCE-EVIDENCE" }, financialFingerprint: "FORBIDDEN-FINANCIAL-FINGERPRINT",
    totals: { total: "10.00", currency: "USD" },
  };
  const result = await readCustomerPortalDocument(rawToken, { idempotencyKey: "view:request-001" }, {
    readGrant: async (input) => (received = input, {
      grant: { expiresAt: "2026-10-01T00:00:00.000Z", allowedActions: ["view_revision"], revisionId },
      revision: { snapshot }, response: { status: "pending", respondedAt: null, customerName: null }, responseEligible: true,
    }),
  });
  assert.equal(received.rawToken, rawToken);
  assert.equal(received.idempotencyKey, "view:request-001");
  assert.match(received.requestHash, /^[0-9a-f]{64}$/);
  assert.equal(result.document.document.number, "EST-1");
  assert.deepEqual(result.document.response, { status: "pending", respondedAt: null, customerName: null });
  const serialized = JSON.stringify(result);
  for (const forbidden of ["FORBIDDEN-DOCUMENT-ID", "FORBIDDEN-REVISION-ID", "FORBIDDEN-ASSET-ID", "FORBIDDEN-LINE-ID", "FORBIDDEN-SOURCE", "FORBIDDEN-FINGERPRINT", "FORBIDDEN-REASON", "FORBIDDEN-SOURCE-EVIDENCE", "FORBIDDEN-FINANCIAL-FINGERPRINT"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test("portal reload after response projects terminal state and removes respond capability", async () => {
  const result = await readCustomerPortalDocument("C".repeat(43), { idempotencyKey: "view:reload-001" }, {
    readGrant: async () => ({
      grant: { expiresAt: "2026-10-01T00:00:00.000Z", allowedActions: ["view_revision", "respond_revision"] },
      revision: { snapshot: { schemaVersion: 1, document: { type: "estimate", number: "EST-1", revision: 1, state: "issued" }, lines: [] } },
      response: { status: "accepted", respondedAt: "2026-09-28T20:00:00.000Z", customerName: "Jane" },
      responseEligible: false,
    }),
  });
  assert.equal(result.document.response.status, "accepted");
  assert.equal(result.grant.responseEligible, false);
  assert.deepEqual(result.grant.allowedActions, ["view_revision"]);
});

test("portal response is exact-revision repository input with a stable request hash", async () => {
  const rawToken = "B".repeat(43);
  let received;
  await respondToCustomerDocument(rawToken, {
    response: "accepted", customerName: "Jane Customer", note: "Approved", idempotencyKey: "response-accept-001",
  }, { respond: async (input) => (received = input, { eventId: "event" }) });
  assert.equal(received.rawToken, rawToken);
  assert.equal(received.responseType, "accepted");
  assert.match(received.requestHash, /^[0-9a-f]{64}$/);
});

test("portal response maps database eligibility races to stable public errors", async () => {
  const input = { response: "accepted", customerName: "Jane", note: "Approved", idempotencyKey: "response-race-001" };
  await assert.rejects(respondToCustomerDocument("D".repeat(43), input, {
    respond: async () => { throw Object.assign(new Error("grant denied"), { code: "42501" }); },
  }), (error) => error.statusCode === 404 && error.code === "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE");
  for (const code of ["40001", "23505"]) {
    await assert.rejects(respondToCustomerDocument("E".repeat(43), input, {
      respond: async () => { throw Object.assign(new Error("state race"), { code }); },
    }), (error) => error.statusCode === 409 && error.code === "CUSTOMER_DOCUMENT_RESPONSE_CONFLICT");
  }
});

test("staff recovers the current accepted Estimate by exact tenant-scoped draft", async () => {
  let received;
  const revision = await readStaffCurrentEstimateByDraft(context(), draftId, { companyId, locationId }, {
    readByDraft: async (input) => (received = input, {
      id: revisionId, snapshot: { document: { number: "EST-1" } },
      response: { status: "accepted" }, eligibility: { canRespond: false, canActivate: true },
    }),
  });
  assert.deepEqual(received, { companyId, locationId, draftId });
  assert.equal(revision.response.status, "accepted");
  assert.equal(revision.eligibility.canActivate, true);
});

test("staff draft recovery denies cross-tenant scope and hides missing Estimates", async () => {
  await assert.rejects(readStaffCurrentEstimateByDraft(context(), draftId, {
    companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", locationId,
  }, { readByDraft: async () => assert.fail("cross-tenant lookup must not reach the repository") }),
  (error) => error.statusCode === 403);
  await assert.rejects(readStaffCurrentEstimateByDraft(context(), draftId, { companyId, locationId }, {
    readByDraft: async () => null,
  }), (error) => error.statusCode === 404);
});

test("Workorder customer-document summary rejects cross-tenant scope before reading", async () => {
  await assert.rejects(readCustomerDocumentWorkorderSummary(context(), workorderId, {
    companyId: "99999999-9999-4999-8999-999999999999", locationId,
  }, { runIssueTransaction: async () => assert.fail("cross-tenant summary must not reach persistence") }),
  (error) => error.statusCode === 403);
});

test("accepted Estimate activation uses the named policy and exact draft pricing evidence", async () => {
  let activationCommand;
  let submitCommand;
  const result = await activateApprovedCustomerEstimate(context(), revisionId, {
    companyId, locationId, expectedDraftVersion: 3, idempotencyKey: "activate-estimate-001",
  }, {
    activate: async (command, submit) => {
      activationCommand = command;
      const submitted = await submit({
        client: { query: async () => ({ rows: [] }) },
        draftId,
        draftVersion: 3,
        pricingFingerprint: "c".repeat(64),
        acceptedEstimateRevisionId: revisionId,
      });
      return { workorderId: submitted.workorderId, replayed: false };
    },
    submitDraftInTransaction: async (command) => {
      submitCommand = command;
      return { workorderId: "88888888-8888-4888-8888-888888888888" };
    },
  });
  assert.equal(result.workorderId, "88888888-8888-4888-8888-888888888888");
  assert.equal(activationCommand.activationPolicy, WORKORDER_ACTIVATION_POLICY.ACCEPTED_CUSTOMER_ESTIMATE);
  assert.equal(submitCommand.version, 3);
  assert.equal(submitCommand.activationPolicy, WORKORDER_ACTIVATION_POLICY.ACCEPTED_CUSTOMER_ESTIMATE);
  assert.equal(submitCommand.acceptedEstimateRevisionId, revisionId);
  assert.match(activationCommand.requestHash, /^[0-9a-f]{64}$/);
});

import { createHash } from "node:crypto";
import { AuthError, permissionDenied, resourceNotFound } from "../../auth/errors.js";
import { requireCompanyAccess, requireLocationAccess, requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import { getPool } from "../../db/pool.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import * as repository from "../../db/repositories/customer-documents.repo.js";
import { buildCustomerDocumentProjection } from "./customer-document-projection.js";
import { buildCustomerDocumentSource } from "./customer-document-source.service.js";
import { reconcileWorkorderEstimate } from "./customer-document-reconciliation.js";
import { submitWorkorderDraftInTransaction } from "../../db/repositories/workorder-drafts.repo.js";
import { prepareUserWorkorderDraftSubmission } from "../workorders/workorder-drafts.service.js";
import { WORKORDER_ACTIVATION_POLICY } from "../../../../shared/customer-document-contract.js";
import { canonicalFinancialHash, canonicalJson } from "./customer-financial-calculator.js";
import {
  customerDocumentGrantRevokeSchema,
  customerDocumentGrantSchema,
  customerDocumentIdSchema,
  customerDocumentPreviewSchema,
  customerDocumentProfileQuerySchema,
  customerDocumentResponseSchema,
  customerDocumentVoidSchema,
  issueCustomerDocumentSchema,
  publishCustomerDocumentProfileSchema,
  customerDocumentActivationSchema,
  customerDocumentDraftQuerySchema,
  customerDocumentWorkorderQuerySchema,
} from "./customer-documents.schemas.js";

const digest = (value) => createHash("sha256").update(canonicalJson(value)).digest("hex");

function mapDomainError(error) {
  if (error instanceof AuthError) throw error;
  if (error?.code === "23505" && error?.constraint === "customer_documents_invoice_workorder_uidx") {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_REVISION_CONFLICT", "An Invoice already exists for this Workorder.");
  }
  const conflicts = new Set([
    "CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT",
    "CUSTOMER_DOCUMENT_PROFILE_VERSION_CONFLICT",
    "CUSTOMER_DOCUMENT_REVISION_CONFLICT",
    "CUSTOMER_DOCUMENT_REVISION_CLOSED",
    "CUSTOMER_DOCUMENT_REVISION_NOT_RESPONSE_ELIGIBLE",
    "CUSTOMER_DOCUMENT_SOURCE_LINEAGE_CONFLICT",
    "CUSTOMER_DOCUMENT_WORKORDER_CONFLICT",
    "CUSTOMER_DOCUMENT_DRAFT_NOT_ISSUABLE",
    "CUSTOMER_DOCUMENT_APPROVAL_REQUIRED",
    "CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY",
    "CUSTOMER_DOCUMENT_CURRENCY_MISMATCH",
    "CUSTOMER_DOCUMENT_SOURCE_CHANGED",
    "CUSTOMER_DOCUMENT_GRANT_NOT_READY",
  ]);
  const badRequests = new Set([
    "CUSTOMER_DOCUMENT_INVALID_HASH",
    "CUSTOMER_DOCUMENT_TYPE_INVALID",
    "CUSTOMER_DOCUMENT_GRANT_ACTIONS_INVALID",
    "CUSTOMER_DOCUMENT_RESPONSE_INVALID",
    "CUSTOMER_DOCUMENT_ESTIMATE_READINESS_INVALID",
    "CUSTOMER_DOCUMENT_FINANCIAL_EVIDENCE_MISMATCH",
  ]);
  const unavailable = new Set([
    "CUSTOMER_DOCUMENT_TAX_PROFILE_UNAVAILABLE",
    "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE",
    "CUSTOMER_DOCUMENT_INVOICE_NOT_READY",
    "CUSTOMER_DOCUMENT_APPROVED_ESTIMATE_INVALID",
  ]);
  if (conflicts.has(error?.code)) throw new AuthError(409, error.code, "Customer document state changed. Refresh and try again.");
  if (badRequests.has(error?.code)) throw new AuthError(400, error.code, "Customer document request is invalid.");
  if (unavailable.has(error?.code)) throw new AuthError(409, error.code, "Customer document prerequisites are not satisfied.");
  if (String(error?.code || "").includes("NOT_FOUND")) throw resourceNotFound("Customer document");
  if (error?.code === "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE") {
    throw new AuthError(404, "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE", "This customer link is unavailable.");
  }
  throw error;
}

function staffScope(context, companyId, locationId, permission = PERMISSION.CUSTOMER_DOCUMENT_WRITE) {
  requirePermission(context, permission);
  requireCompanyAccess(context, companyId);
  requireLocationAccess(context, locationId);
  return { companyId, locationId, actorId: context.actor.id };
}

function profileTaxComponents(profile) {
  return profile?.taxComponents || profile?.taxProfile?.components || profile?.tax_profile_components || [];
}

function profileTaxCurrency(profile) {
  return profile?.taxCurrency || profile?.taxProfile?.currency || profile?.tax_profile_currency || profile?.defaultCurrency;
}

function trustedProjectionInput(input, profile, state) {
  const taxComponents = profileTaxComponents(profile);
  const taxCurrency = profileTaxCurrency(profile);
  if (input.profileVersionId && profile.id !== input.profileVersionId && profile.profileVersionId !== input.profileVersionId) {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_PROFILE_STALE", "Refresh the commercial profile before continuing.");
  }
  if (taxCurrency && taxCurrency !== input.financial.currency) {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_CURRENCY_MISMATCH", "The selected tax and document currencies do not match.");
  }
  const profileTaxId = profile.taxProfileVersionId || profile.tax_profile_version_id;
  if (input.taxProfileVersionId && profileTaxId !== input.taxProfileVersionId) {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_TAX_PROFILE_STALE", "Refresh the tax profile before continuing.");
  }
  const taxable = new Set(["exclusive", "inclusive"]);
  const financial = {
    ...input.financial,
    currency: profile.defaultCurrency || input.financial.currency,
    lines: input.financial.lines.map((line) => ({
      ...line,
      taxComponents: taxable.has(line.taxTreatment) ? taxComponents : [],
    })),
  };
  const shopIdentity = profile.shopIdentity || {};
  const terms = profile.documentTerms || {};
  return {
    ...input,
    document: { ...input.document, state },
    shop: {
      legalName: shopIdentity.legalName,
      tradeName: shopIdentity.tradeName || null,
      address: shopIdentity.address || null,
      phone: shopIdentity.phone || null,
      email: shopIdentity.email || null,
      registrationIdentifiers: shopIdentity.registrationIdentifiers || {},
      logoUrl: shopIdentity.logoUrl || null,
      accentColor: shopIdentity.accentColor || null,
    },
    terms: input.document.type === "invoice" ? terms.invoice || "" : terms.estimate || "",
    authorizationText: profile.authorizationText || "",
    warrantyText: terms.warranty || "",
    footer: terms.footer || "",
    taxProfileVersionId: profileTaxId,
    financial,
  };
}

async function directoryRecipient(client, companyId, customerId, contactId) {
  if (!customerId && contactId) throw new AuthError(400, "CUSTOMER_CONTACT_CUSTOMER_REQUIRED", "Select a customer for this contact.");
  if (!customerId) return null;
  const customer = (await client.query(
    "select id,name,address from customer_directory_customers where company_id=$1 and id=$2",
    [companyId, customerId],
  )).rows[0];
  if (!customer) throw resourceNotFound("Customer");
  const contact = contactId ? (await client.query(
    "select id,name,email,phone from customer_directory_contacts where company_id=$1 and customer_id=$2 and id=$3",
    [companyId, customerId, contactId],
  )).rows[0] : null;
  if (contactId && !contact) throw resourceNotFound("Customer contact");
  return {
    name: contact?.name || customer.name, company: customer.name, address: customer.address || null,
    email: contact?.email || null, phone: contact?.phone || null,
    customerId: customer.id, contactId: contact?.id || null,
  };
}

async function currentProfile(companyId, locationId, requestedId, dependencies) {
  const load = dependencies.getProfile || repository.getCustomerDocumentProfileForScope;
  if (!load) throw new AuthError(409, "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE", "Publish a commercial profile first.");
  const profile = await load({ companyId, locationId, profileVersionId: requestedId });
  if (!profile) throw new AuthError(409, "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE", "Publish a commercial profile first.");
  const version = profile.profileVersion || profile;
  if (version.informationalOnly && !dependencies.allowInformational) {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE", "Publish a commercial profile before issuing a priced Estimate.");
  }
  return version;
}

async function runIssueTransaction(work, dependencies) {
  if (dependencies.runIssueTransaction) return dependencies.runIssueTransaction(work);
  const client = await (dependencies.pool || getPool()).connect();
  try {
    await client.query("begin isolation level repeatable read");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function lockedSource(client, input) {
  if (!client) return null;
  if (input.source.kind === "draft") {
    const row = (await client.query(
      `select * from workorder_drafts
        where company_id=$1 and location_id=$2 and id=$3 and status='active' and version=$4
        for update`,
      [input.companyId, input.locationId, input.source.id, input.source.expectedVersion],
    )).rows[0];
    if (!row) throw new AuthError(409, "CUSTOMER_DOCUMENT_SOURCE_CHANGED", "This draft changed. Refresh the Estimate preview.");
    return {
      id: row.id, companyId: row.company_id, locationId: row.location_id, status: row.status,
      version: Number(row.version), payload: row.payload,
    };
  }
  const row = (await client.query(
    `select id,company_id,location_id,status,progress_version from operational_workorders
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    [input.companyId, input.locationId, input.source.id],
  )).rows[0];
  if (!row) throw resourceNotFound("Workorder");
  if (Number(row.progress_version) !== Number(input.source.expectedVersion)) {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_SOURCE_CHANGED", "This Workorder changed. Refresh the document preview.");
  }
  return { progressVersion: Number(row.progress_version), status: row.status };
}

function transactionSourceDependencies(dependencies, client, input, locked, documentType = "estimate") {
  return {
    ...dependencies,
    client,
    companyId: input.companyId,
    locationId: input.locationId,
    documentType,
    ...(client ? {
      getProfile: dependencies.getProfile || ((queryInput) => repository.getCustomerDocumentProfileForScope(queryInput, {
        query: client.query.bind(client),
      })),
      readCreatePricing: dependencies.readCreatePricing || ((pricingInput) => readCreatePricing(pricingInput, client)),
    } : {}),
    ...(input.source.kind === "draft" && locked ? { getDraft: async () => locked } : {}),
  };
}

function invoiceProjection(acceptedEstimate, actualProjection, profile) {
  const accepted = acceptedEstimate.snapshot;
  const projection = {
    ...accepted,
    document: { id: null, revisionId: null, type: "invoice", number: null, revision: null, state: "draft_projection", issuedAt: null, expiresAt: null },
    shop: actualProjection.shop,
    customer: actualProjection.customer,
    unit: actualProjection.unit,
    concern: actualProjection.concern,
    repairDescription: actualProjection.repairDescription,
    basis: "actual",
    terms: actualProjection.terms,
    warrantyText: actualProjection.warrantyText,
    footer: actualProjection.footer,
    profileVersionId: profile.id,
    taxProfileVersionId: profile.taxProfileVersionId,
    relatedDocuments: [{
      id: acceptedEstimate.documentId,
      type: "estimate",
      number: acceptedEstimate.documentNumber,
      revision: acceptedEstimate.revisionNumber,
    }],
    response: { status: "not_applicable", respondedAt: null, customerName: null },
    sourceEvidence: actualProjection.sourceEvidence,
  };
  projection.financialFingerprint = canonicalFinancialHash({
    basis: "actual",
    currency: projection.totals.currency,
    minorDigits: projection.totals.minorDigits,
    lines: projection.lines,
    summary: projection.totals,
  });
  return projection;
}

export async function previewCustomerDocument(context, rawInput, dependencies = {}) {
  const input = customerDocumentPreviewSchema.parse(rawInput);
  staffScope(context, input.companyId, input.locationId, PERMISSION.CUSTOMER_DOCUMENT_READ);
  if (input.source.kind === "draft") {
    const profile = await currentProfile(input.companyId, input.locationId, null, dependencies);
    const sourceInput = await (dependencies.buildSource || buildCustomerDocumentSource)(
      context, input.source, input.adjustments, profile, dependencies,
    );
    return buildCustomerDocumentProjection(trustedProjectionInput(sourceInput, profile, "draft_projection"));
  }
  try {
    return await runIssueTransaction(async (client) => {
      const locked = await lockedSource(client, input);
      const txDependencies = transactionSourceDependencies(dependencies, client, input, locked, input.documentType);
      const profile = await currentProfile(input.companyId, input.locationId, null, txDependencies);
      const sourceInput = await (dependencies.buildSource || buildCustomerDocumentSource)(
        context, input.source, input.adjustments, profile, txDependencies,
      );
      const actual = buildCustomerDocumentProjection(trustedProjectionInput(sourceInput, profile, "draft_projection")).projection;
      const accepted = await (dependencies.readAcceptedEstimate || repository.getCurrentAcceptedEstimateForWorkorder)(
        { companyId: input.companyId, locationId: input.locationId, workorderId: input.source.id }, { client },
      );
      const reconciliation = reconcileWorkorderEstimate({ actualSource: actual, acceptedEstimate: accepted });
      if (input.documentType === "invoice") {
        if (locked.status !== "mechanic_done" || !reconciliation.invoiceEligible) {
          throw new AuthError(409, "CUSTOMER_DOCUMENT_INVOICE_NOT_READY", "A current accepted revised Estimate matching Work done is required.");
        }
        const projection = invoiceProjection(accepted, actual, profile);
        return { projection, contentHash: canonicalFinancialHash(projection), reconciliation };
      }
      return { projection: actual, contentHash: canonicalFinancialHash(actual), reconciliation };
    }, dependencies);
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function readCustomerDocumentProfile(context, rawInput, dependencies = {}) {
  const input = customerDocumentProfileQuerySchema.parse(rawInput);
  requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_READ);
  requireCompanyAccess(context, input.companyId);
  if (input.locationId) requireLocationAccess(context, input.locationId);
  const load = dependencies.getProfile || repository.getCustomerDocumentProfileForScope;
  const profile = await load(input);
  if (!profile) throw resourceNotFound("Customer document profile");
  return profile.profileVersion || profile;
}

export async function publishCustomerDocumentProfile(context, rawInput, dependencies = {}) {
  const input = publishCustomerDocumentProfileSchema.parse(rawInput);
  if (context?.actor?.role !== "admin") throw permissionDenied();
  requireCompanyAccess(context, input.companyId);
  if (input.locationId) requireLocationAccess(context, input.locationId);
  const command = { ...input, actorId: context.actor.id };
  try {
    const publish = dependencies.publishProfile || repository.publishCustomerDocumentProfile;
    return await publish({ ...command, requestHash: digest(command) });
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function issueCustomerDocument(context, rawInput, dependencies = {}) {
  const input = issueCustomerDocumentSchema.parse(rawInput);
  const scope = staffScope(context, input.companyId, input.locationId);
  try {
    return await runIssueTransaction(async (client) => {
      const locked = await lockedSource(client, input);
      const transactionDependencies = transactionSourceDependencies(dependencies, client, input, locked, input.documentType);
      const profile = await currentProfile(input.companyId, input.locationId, null, transactionDependencies);
      const sourceInput = await (dependencies.buildSource || buildCustomerDocumentSource)(
        context, input.source, input.adjustments, profile, transactionDependencies,
      );
      if (locked?.progressVersion !== undefined && sourceInput.sourceEvidence.version !== locked.progressVersion) {
        throw new AuthError(409, "CUSTOMER_DOCUMENT_SOURCE_CHANGED", "This Workorder changed. Refresh the Estimate preview.");
      }
      const actualProjection = buildCustomerDocumentProjection(trustedProjectionInput(sourceInput, profile, "issued")).projection;
      let reconciliation = null;
      let trustedInput = sourceInput;
      if (input.documentType === "invoice") {
        const accepted = await (dependencies.readAcceptedEstimate || repository.getCurrentAcceptedEstimateForWorkorder)(
          { companyId: input.companyId, locationId: input.locationId, workorderId: input.workorderId }, { client },
        );
        reconciliation = reconcileWorkorderEstimate({ actualSource: actualProjection, acceptedEstimate: accepted });
        if (locked.status !== "mechanic_done" || !reconciliation.invoiceEligible
          || reconciliation.reconciliationHash !== input.expectedReconciliationHash) {
          throw new AuthError(409, "CUSTOMER_DOCUMENT_INVOICE_NOT_READY", "Work done no longer matches the current accepted Estimate.");
        }
        trustedInput = invoiceProjection(accepted, actualProjection, profile);
      } else {
        trustedInput = trustedProjectionInput(sourceInput, profile, "issued");
      }
      const sourceCustomer = trustedInput.customer || {};
      const selectedRecipient = await directoryRecipient(client, input.companyId,
        input.recipient.customerId, input.recipient.contactId);
      const recipientCustomer = {
        name: selectedRecipient?.name ?? input.recipient.name ?? sourceCustomer.name ?? null,
        company: selectedRecipient?.company ?? input.recipient.company ?? sourceCustomer.company ?? null,
        address: selectedRecipient?.address ?? input.recipient.address ?? sourceCustomer.address ?? null,
        email: selectedRecipient?.email ?? input.recipient.email ?? sourceCustomer.email ?? null,
        phone: selectedRecipient?.phone ?? input.recipient.phone ?? sourceCustomer.phone ?? null,
      };
      if (input.recipient.channel === "link" && !recipientCustomer.name && !recipientCustomer.company) {
        throw new AuthError(400, "CUSTOMER_DOCUMENT_RECIPIENT_REQUIRED", "Add a customer name or company before issuing a link.");
      }
      if (input.recipient.channel === "email" && !recipientCustomer.email) {
        throw new AuthError(400, "CUSTOMER_DOCUMENT_DELIVERY_ADDRESS_REQUIRED", "Add a customer email before selecting email delivery.");
      }
      if (input.recipient.channel === "sms" && !recipientCustomer.phone) {
        throw new AuthError(400, "CUSTOMER_DOCUMENT_DELIVERY_ADDRESS_REQUIRED", "Add a customer phone before selecting SMS delivery.");
      }
      trustedInput.customer = recipientCustomer;
      const built = input.documentType === "invoice"
        ? { projection: { ...trustedInput, document: { ...trustedInput.document, state: "issued" } }, contentHash: canonicalFinancialHash(trustedInput) }
        : buildCustomerDocumentProjection(trustedInput);
      const { projection, contentHash } = built;
      if (projection.financialFingerprint !== input.expectedFinancialFingerprint) {
        throw new AuthError(409, "CUSTOMER_DOCUMENT_SOURCE_CHANGED", "The saved pricing changed. Refresh the Estimate preview.");
      }
      const command = {
        ...scope,
        documentId: input.documentId,
        predecessorRevisionId: input.predecessorRevisionId,
        draftId: input.draftId,
        workorderId: input.workorderId,
        documentType: input.documentType,
        profileVersionId: projection.profileVersionId,
        snapshot: projection,
        contentHash,
        financialFingerprint: projection.financialFingerprint,
        recipientSnapshot: { ...recipientCustomer, channel: input.recipient.channel,
          customerId: selectedRecipient?.customerId || null, contactId: selectedRecipient?.contactId || null },
        currency: projection.totals.currency,
        subtotal: projection.totals.subtotal,
        discountTotal: projection.totals.discountTotal,
        taxTotal: projection.totals.tax,
        totalAmount: projection.totals.total,
        invoiceReadiness: reconciliation ? {
          workorderVersion: reconciliation.workorderVersion,
          reconciliationHash: reconciliation.reconciliationHash,
          authorizationBasis: "accepted_estimate",
          actualPricingFingerprint: reconciliation.actualPricingFingerprint,
          sourceMatchMode: reconciliation.sourceMatchMode,
          actualScopeHash: reconciliation.actualScopeHash,
          acceptedScopeHash: reconciliation.acceptedScopeHash,
        } : null,
        approvedEstimateRevisionId: reconciliation?.acceptedEstimateRevisionId || null,
        idempotencyKey: input.idempotencyKey,
      };
      const issue = dependencies.issueRevision || repository.issueCustomerDocumentRevision;
      return issue({ ...command, requestHash: digest(command) }, client ? { client } : {});
    }, dependencies);
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function issueInformationalDraftEstimate(context, draft, preparedInput, client, dependencies = {}) {
  const scope = staffScope(context, draft.companyId, draft.locationId);
  const source = { kind: "draft", id: draft.id, expectedVersion: draft.version };
  const commandInput = { ...scope, source, documentType: "estimate" };
  const financialDraft = { ...draft, payload: { ...draft.payload, pricing: preparedInput.pricing } };
  const sourceDependencies = { ...transactionSourceDependencies(dependencies, client, commandInput, financialDraft),
    allowInformational: true };
  const profile = await (dependencies.ensureInformationalProfile || repository.ensureInformationalCustomerDocumentProfile)(
    { companyId: draft.companyId, locationId: draft.locationId, actorId: context.actor.id }, client,
  );
  let sourceInput;
  let pricingStatus = "priced";
  if (!profile.informationalOnly) {
    try {
      sourceInput = await (dependencies.buildSource || buildCustomerDocumentSource)(
        context, source, { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile, sourceDependencies,
      );
    } catch (error) {
      if (!["CUSTOMER_DOCUMENT_EMPTY_ESTIMATE", "CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED",
        "CUSTOMER_DOCUMENT_TAX_NOT_CONFIGURED", "CUSTOMER_DOCUMENT_CURRENCY_MISMATCH"].includes(error?.code)) throw error;
    }
  }
  if (!sourceInput) {
    const pricing = await (dependencies.readCreatePricing || readCreatePricing)(preparedInput, client);
    const formData = draft.payload?.formData || {};
    pricingStatus = "pending";
    sourceInput = {
      document: { id: null, revisionId: null, type: "estimate", number: null, revision: null,
        state: "draft_projection", issuedAt: null, expiresAt: null },
      shop: profile.shopIdentity,
      customer: { name: formData.customerCompanyName || formData.companyName || null,
        company: formData.customerCompanyName || formData.companyName || null,
        address: null, email: null, phone: null },
      unit: { id: preparedInput.assetId || null, label: formData.unitNo || formData.vinNo || "Customer unit",
        vin: formData.vinNo || null, make: null, model: formData.model || null, year: null },
      concern: preparedInput.concern || "", repairDescription: formData.workPerformed || "",
      terms: "Scope only. Prices and taxes are not yet quoted.",
      authorizationText: "Customer approval is not required to start this Workorder.",
      warrantyText: "", footer: "", profileVersionId: profile.id,
      templateVersion: "customer-document-v1", taxProfileVersionId: null, relatedDocuments: [],
      response: { status: "not_applicable", respondedAt: null, customerName: null },
      financial: { currency: profile.defaultCurrency, basis: "estimated", lines: [], documentDiscount: null },
      sourceEvidence: { kind: "draft", id: draft.id, version: draft.version, pricingFingerprint: pricing.fingerprint },
      discountEvidence: { documentDiscount: null },
    };
  }
  const directory = await directoryRecipient(client, draft.companyId,
    draft.payload?.formData?.customerAccountId || null, draft.payload?.formData?.customerContactId || null);
  const customer = {
    name: directory?.name || draft.payload?.formData?.customerContactName
      || sourceInput.customer?.name || null,
    company: directory?.company || sourceInput.customer?.company || null,
    address: directory?.address || null,
    email: directory?.email || draft.payload?.formData?.customerEmail || null,
    phone: directory?.phone || draft.payload?.formData?.customerPhone || null,
  };
  if (!customer.name && !customer.company) {
    throw new AuthError(400, "CUSTOMER_DOCUMENT_RECIPIENT_REQUIRED", "Add a customer name before creating the Workorder.");
  }
  const currentEstimate = await (
    dependencies.readCurrentEstimateForUpdate || repository.getCurrentEstimateByDraftForUpdate
  )({ companyId: draft.companyId, locationId: draft.locationId, draftId: draft.id }, { client });
  const currentSource = currentEstimate?.snapshot?.sourceEvidence || null;
  const currentRecipient = currentEstimate?.recipientSnapshot || null;
  const recipientUnchanged = currentRecipient
    && (currentRecipient.customerId || null) === (directory?.customerId || null)
    && (currentRecipient.contactId || null) === (directory?.contactId || null)
    && (currentRecipient.name || null) === (customer.name || null)
    && (currentRecipient.company || null) === (customer.company || null)
    && (currentRecipient.address || null) === (customer.address || null)
    && (currentRecipient.email || null) === (customer.email || null)
    && (currentRecipient.phone || null) === (customer.phone || null);
  if (currentEstimate && Number(currentSource?.version) === Number(draft.version) && recipientUnchanged) {
    return { revision: currentEstimate, replayed: true };
  }
  sourceInput.customer = customer;
  const { projection } = buildCustomerDocumentProjection(trustedProjectionInput(sourceInput, profile, "issued"));
  projection.pricingStatus = pricingStatus;
  const contentHash = canonicalFinancialHash(projection);
  const command = {
    ...scope,
    documentId: currentEstimate?.documentId || null,
    predecessorRevisionId: currentEstimate?.id || null,
    draftId: draft.id, workorderId: null,
    documentType: "estimate", profileVersionId: projection.profileVersionId,
    snapshot: projection, contentHash, financialFingerprint: projection.financialFingerprint,
    recipientSnapshot: { ...customer, channel: "link", customerId: directory?.customerId || null,
      contactId: directory?.contactId || null },
    currency: projection.totals.currency, subtotal: projection.totals.subtotal,
    discountTotal: projection.totals.discountTotal, taxTotal: projection.totals.tax,
    totalAmount: projection.totals.total, invoiceReadiness: null,
    approvedEstimateRevisionId: null, idempotencyKey: `informational:${draft.id}:${draft.version}`,
    informationalOnly: true,
  };
  return (dependencies.issueRevision || repository.issueCustomerDocumentRevision)(
    { ...command, requestHash: digest(command) }, { client },
  );
}

export async function readStaffCustomerDocumentRevision(context, rawRevisionId, dependencies = {}) {
  const revisionId = customerDocumentIdSchema.parse(rawRevisionId);
  requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_READ);
  const read = dependencies.readRevision || repository.getStaffCustomerDocumentRevision;
  const revision = await read({
    revisionId,
    companyIds: [...(context.companyIds || [])],
    locationIds: [...(context.locationIds || [])],
    isAdmin: context.actor.role === "admin",
  });
  if (!revision) throw resourceNotFound("Customer document revision");
  return revision;
}

export async function readStaffCurrentEstimateByDraft(context, rawDraftId, rawQuery, dependencies = {}) {
  const draftId = customerDocumentIdSchema.parse(rawDraftId);
  const input = customerDocumentDraftQuerySchema.parse(rawQuery);
  staffScope(context, input.companyId, input.locationId, PERMISSION.CUSTOMER_DOCUMENT_READ);
  const read = dependencies.readByDraft || repository.getStaffCurrentEstimateByDraft;
  const revision = await read({ ...input, draftId });
  if (!revision) throw resourceNotFound("Customer Estimate");
  return revision;
}

export async function readCustomerDocumentWorkorderSummary(context, rawWorkorderId, rawQuery, dependencies = {}) {
  const workorderId = customerDocumentIdSchema.parse(rawWorkorderId);
  const input = customerDocumentWorkorderQuerySchema.parse(rawQuery);
  staffScope(context, input.companyId, input.locationId, PERMISSION.CUSTOMER_DOCUMENT_READ);
  return runIssueTransaction(async (client) => {
    const workorder = (await client.query(
      `select workorder.status,workorder.progress_version,auth_event.classification
         from operational_workorders workorder
         left join workorder_authorization_events auth_event
           on auth_event.company_id=workorder.company_id and auth_event.workorder_id=workorder.id
        where workorder.company_id=$1 and workorder.location_id=$2 and workorder.id=$3 for update of workorder`,
      [input.companyId, input.locationId, workorderId],
    )).rows[0];
    if (!workorder) throw resourceNotFound("Workorder");
    const source = { kind: "workorder", id: workorderId, expectedVersion: Number(workorder.progress_version) };
    const command = { ...input, source };
    const locked = { status: workorder.status, progressVersion: Number(workorder.progress_version) };
    const txDependencies = transactionSourceDependencies(dependencies, client, command, locked);
    const profile = await currentProfile(input.companyId, input.locationId, null, txDependencies);
    const read = dependencies.readSummary || repository.getCustomerDocumentSummaryByWorkorder;
    const documents = await read({ ...input, workorderId }, { query: client.query.bind(client) });
    let reconciliation;
    try {
      const sourceInput = await (dependencies.buildSource || buildCustomerDocumentSource)(
        context, source, { lineDiscounts: [], documentDiscount: null, overrideReasons: [] }, profile, txDependencies,
      );
      const actual = buildCustomerDocumentProjection(trustedProjectionInput(sourceInput, profile, "draft_projection")).projection;
      const accepted = await (dependencies.readAcceptedEstimate || repository.getCurrentAcceptedEstimateForWorkorder)(
        { ...input, workorderId }, { client },
      );
      reconciliation = reconcileWorkorderEstimate({ actualSource: actual, acceptedEstimate: accepted });
    } catch (error) {
      if (!["CUSTOMER_DOCUMENT_SELLING_PRICE_REQUIRED", "CUSTOMER_DOCUMENT_EMPTY_ESTIMATE"].includes(error?.code)) throw error;
      reconciliation = {
        status: "financial_source_incomplete",
        invoiceEligible: false,
        requiresRevisedEstimate: false,
        blocker: error.code,
        workorderId,
        workorderVersion: locked.progressVersion,
      };
    }
    return {
      workorderId,
      status: locked.status,
      workorderVersion: locked.progressVersion,
      authorizationClassification: workorder.classification || null,
      approvalRequired: workorder.classification === "required_external_customer",
      documents,
      reconciliation,
    };
  }, dependencies);
}

export async function voidCustomerDocument(context, rawRevisionId, rawInput, dependencies = {}) {
  const revisionId = customerDocumentIdSchema.parse(rawRevisionId);
  const input = customerDocumentVoidSchema.parse(rawInput);
  const command = { ...staffScope(context, input.companyId, input.locationId), ...input, revisionId };
  try {
    const mutate = dependencies.voidRevision || repository.voidCustomerDocumentRevision;
    return await mutate({ ...command, requestHash: digest(command) });
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function createCustomerDocumentGrant(context, rawInput, dependencies = {}) {
  const input = customerDocumentGrantSchema.parse(rawInput);
  const { allowedActions: _advisoryActions, ...canonicalInput } = input;
  const command = { ...staffScope(context, input.companyId, input.locationId), ...canonicalInput };
  const expiresAt = new Date(input.expiresAt);
  const lifetime = expiresAt.getTime() - Date.now();
  if (lifetime < 5 * 60_000 || lifetime > 90 * 24 * 60 * 60_000) {
    throw new AuthError(400, "CUSTOMER_DOCUMENT_GRANT_EXPIRY_INVALID", "Customer links must expire between 5 minutes and 90 days from now.");
  }
  const repositoryCommand = { ...command, requestHash: digest(command) };
  try {
    const issue = dependencies.issueGrant || repository.createCustomerDocumentGrant;
    return await issue(repositoryCommand);
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function revokeCustomerDocumentGrant(context, rawGrantId, rawInput, dependencies = {}) {
  const grantId = customerDocumentIdSchema.parse(rawGrantId);
  const input = customerDocumentGrantRevokeSchema.parse(rawInput);
  const command = { ...staffScope(context, input.companyId, input.locationId), ...input, grantId };
  try {
    const revoke = dependencies.revokeGrant || repository.revokeCustomerDocumentGrant;
    return await revoke({ ...command, requestHash: digest(command) });
  } catch (error) {
    return mapDomainError(error);
  }
}

export async function activateApprovedCustomerEstimate(context, rawRevisionId, rawInput, dependencies = {}) {
  const revisionId = customerDocumentIdSchema.parse(rawRevisionId);
  const input = customerDocumentActivationSchema.parse(rawInput);
  const scope = staffScope(context, input.companyId, input.locationId);
  const command = {
    ...scope,
    ...input,
    revisionId,
    activationPolicy: WORKORDER_ACTIVATION_POLICY.ACCEPTED_CUSTOMER_ESTIMATE,
  };
  try {
    const activate = dependencies.activate || repository.activateApprovedEstimate;
    return await activate({ ...command, requestHash: digest(command) }, async ({
      client, draftId, draftVersion, pricingFingerprint, acceptedEstimateRevisionId,
    }) => {
      if (!pricingFingerprint) {
        throw new AuthError(409, "CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY", "The accepted Estimate has no trusted pricing evidence.");
      }
      const result = await (dependencies.submitDraftInTransaction || submitWorkorderDraftInTransaction)({
        id: draftId,
        companyIds: [...(context.companyIds || [])],
        locationIds: [...(context.locationIds || [])],
        role: context.actor.role,
        userId: context.actor.id,
        version: draftVersion,
        activationPolicy: WORKORDER_ACTIVATION_POLICY.ACCEPTED_CUSTOMER_ESTIMATE,
        acceptedEstimateRevisionId,
        authorizationSourceDraftId: draftId,
        prepareCreateInput: async (draft) => {
          const pricing = { ...(draft.payload?.pricing || {}), expectedFingerprint: pricingFingerprint };
          const prepared = await prepareUserWorkorderDraftSubmission(context, draft, pricing, dependencies);
          if (!prepared.mechanicUserIds?.length) {
            throw new AuthError(409, "CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY", "Assign at least one mechanic before activating an accepted Estimate.");
          }
          prepared.activationPolicy = WORKORDER_ACTIVATION_POLICY.ACCEPTED_CUSTOMER_ESTIMATE;
          prepared.acceptedEstimateRevisionId = acceptedEstimateRevisionId;
          return prepared;
        },
      }, client, dependencies.workorderRepositoryDependencies || {});
      if (!result) throw resourceNotFound("Draft");
      return result;
    }, dependencies.activationRepositoryDependencies || {});
  } catch (error) {
    return mapDomainError(error);
  }
}

function rawGrantToken(value) {
  const token = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AuthError(404, "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE", "This customer link is unavailable.");
  }
  return token;
}

function publicCustomerDocumentSnapshot(snapshot, response) {
  const publicDocument = snapshot?.document || {};
  return {
    schemaVersion: snapshot?.schemaVersion,
    document: {
      type: publicDocument.type,
      number: publicDocument.number,
      revision: publicDocument.revision,
      state: publicDocument.state,
      issuedAt: publicDocument.issuedAt,
      expiresAt: publicDocument.expiresAt,
    },
    shop: snapshot?.shop,
    customer: snapshot?.customer,
    unit: snapshot?.unit ? {
      label: snapshot.unit.label, vin: snapshot.unit.vin, make: snapshot.unit.make,
      model: snapshot.unit.model, year: snapshot.unit.year,
    } : null,
    concern: snapshot?.concern,
    repairDescription: snapshot?.repairDescription,
    lines: (snapshot?.lines || []).map((line, index) => ({
      id: `line-${index + 1}`,
      type: line.type, description: line.description, quantity: line.quantity, unit: line.unit,
      unitPrice: line.unitPrice, taxCategory: line.taxCategory, taxTreatment: line.taxTreatment,
      gross: line.gross, lineDiscount: line.lineDiscount,
      documentDiscountAllocation: line.documentDiscountAllocation, net: line.net,
      tax: line.tax, total: line.total, taxComponents: line.taxComponents,
    })),
    totals: snapshot?.totals,
    pricingStatus: snapshot?.pricingStatus || "priced",
    basis: snapshot?.basis,
    terms: snapshot?.terms,
    authorizationText: snapshot?.authorizationText,
    warrantyText: snapshot?.warrantyText,
    footer: snapshot?.footer,
    response,
  };
}

export async function readCustomerPortalDocument(rawToken, audit = {}, dependencies = {}) {
  const read = dependencies.readGrant || repository.viewCustomerDocumentGrant;
  const command = {
    rawToken: rawGrantToken(rawToken),
    idempotencyKey: String(audit.idempotencyKey || "").trim(),
  };
  if (command.idempotencyKey.length < 8 || command.idempotencyKey.length > 200) {
    throw new AuthError(400, "CUSTOMER_DOCUMENT_VIEW_IDEMPOTENCY_INVALID", "A valid view request identity is required.");
  }
  const result = await read({ ...command, requestHash: digest({ idempotencyKey: command.idempotencyKey }) });
  if (!result) throw new AuthError(404, "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE", "This customer link is unavailable.");
  return {
    document: publicCustomerDocumentSnapshot(result.revision.snapshot, result.response),
    approvalRequired: result.approvalRequired === true,
    grant: {
      expiresAt: result.grant.expiresAt,
      allowedActions: result.responseEligible
        ? result.grant.allowedActions
        : result.grant.allowedActions.filter((action) => action !== "respond_revision"),
      responseEligible: result.responseEligible,
    },
  };
}

export async function respondToCustomerDocument(rawToken, rawInput, dependencies = {}) {
  const input = customerDocumentResponseSchema.parse(rawInput);
  const command = {
    rawToken: rawGrantToken(rawToken),
    responseType: input.response,
    customerName: input.customerName,
    note: input.note,
    idempotencyKey: input.idempotencyKey,
  };
  try {
    const respond = dependencies.respond || repository.recordCustomerDocumentResponse;
    return await respond({ ...command, requestHash: digest(command) });
  } catch (error) {
    if (error?.code === "42501") {
      throw new AuthError(404, "CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE", "This customer link is unavailable.");
    }
    if (error?.code === "40001" || error?.code === "23505") {
      throw new AuthError(409, "CUSTOMER_DOCUMENT_RESPONSE_CONFLICT", "This Estimate response is no longer available. Reload the document.");
    }
    return mapDomainError(error);
  }
}

export function customerDocumentRequestHash(value) {
  return digest(value);
}

export function customerDocumentContentHash(value) {
  return canonicalFinancialHash(value);
}

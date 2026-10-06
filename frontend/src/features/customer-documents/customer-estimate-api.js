import { api } from "../../lib/api.js";
import { customerDocumentProjection } from "./customer-document-model.js";

export function customerDocumentCommandKey(prefix) {
  return globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random()}`;
}

export const emptyCustomerDocumentAdjustments = () => ({ lineDiscounts: [], documentDiscount: null, overrideReasons: [] });

function normalizedAdjustments(adjustments) {
  return adjustments || emptyCustomerDocumentAdjustments();
}

export async function readCustomerDocumentProfile({ companyId, locationId }) {
  const params = new URLSearchParams({ companyId, ...(locationId ? { locationId } : {}) });
  const result = await api(`/api/customer-documents/profile?${params}`);
  return result.profile || result;
}

export async function previewDraftEstimate({ companyId, locationId, draftId, expectedVersion, adjustments }) {
  const result = await api("/api/customer-documents/previews", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      locationId,
      source: { kind: "draft", id: draftId, expectedVersion },
      adjustments: normalizedAdjustments(adjustments),
    }),
  });
  return customerDocumentProjection(result.projection);
}

export async function issueDraftEstimate({ companyId, locationId, draftId, expectedVersion, projection, adjustments, recipient, idempotencyKey }) {
  return api("/api/customer-documents/revisions", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      locationId,
      documentId: null,
      predecessorRevisionId: null,
      draftId,
      workorderId: null,
      documentType: "estimate",
      source: { kind: "draft", id: draftId, expectedVersion },
      expectedFinancialFingerprint: projection.financialFingerprint,
      adjustments: normalizedAdjustments(adjustments),
      recipient: { customerId: recipient?.customerId || null, contactId: recipient?.contactId || null, name: recipient?.name || null, company: recipient?.company || null, address: null, email: recipient?.email || null, phone: recipient?.phone || null, channel: "link" },
      idempotencyKey,
    }),
  });
}

export async function createEstimateGrant({ companyId, locationId, revisionId, idempotencyKey, expiresAt }) {
  return createCustomerDocumentGrant({
    companyId,
    locationId,
    revisionId,
    allowedActions: [],
    idempotencyKey,
    expiresAt,
  });
}

export async function createCustomerDocumentGrant({ companyId, locationId, revisionId, allowedActions, idempotencyKey, expiresAt }) {
  return api(`/api/customer-documents/revisions/${encodeURIComponent(revisionId)}/grants`, {
    method: "POST",
    body: JSON.stringify({
      companyId,
      locationId,
      allowedActions,
      expiresAt,
      idempotencyKey,
    }),
  });
}

export async function sendCustomerDocumentGrantEmail({ companyId, locationId, grantId, rawToken, recipientEmail, idempotencyKey }) {
  return api(`/api/customer-documents/grants/${encodeURIComponent(grantId)}/email`, {
    method: "POST",
    body: JSON.stringify({ companyId, locationId, rawToken, recipientEmail: recipientEmail || null, idempotencyKey }),
  });
}

export async function readWorkorderCustomerDocumentSummary({ companyId, locationId, workorderId }) {
  const params = new URLSearchParams({ companyId, locationId });
  return api(`/api/customer-documents/workorders/${encodeURIComponent(workorderId)}/summary?${params}`);
}

export async function readWorkorderCustomerChat({ companyId, locationId, workorderId, documentId, revisionId }) {
  const params = new URLSearchParams({ companyId, locationId, documentId, revisionId });
  return api(`/api/customer-documents/workorders/${encodeURIComponent(workorderId)}/customer-chat?${params}`);
}

export async function sendWorkorderCustomerChat({ companyId, locationId, workorderId, documentId, revisionId, body, idempotencyKey }) {
  return api(`/api/customer-documents/workorders/${encodeURIComponent(workorderId)}/customer-chat`, {
    method: "POST",
    body: JSON.stringify({ companyId, locationId, documentId, revisionId, body, idempotencyKey }),
  });
}

export async function previewWorkorderCustomerDocument({ companyId, locationId, workorderId, expectedVersion, documentType, adjustments }) {
  const result = await api("/api/customer-documents/previews", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      locationId,
      documentType,
      source: { kind: "workorder", id: workorderId, expectedVersion },
      adjustments: normalizedAdjustments(adjustments),
    }),
  });
  return { projection: customerDocumentProjection(result.projection), reconciliation: result.reconciliation || null };
}

export async function issueWorkorderCustomerDocument({ companyId, locationId, workorderId, expectedVersion, documentType, projection, reconciliation, adjustments, predecessor, recipient, idempotencyKey }) {
  return api("/api/customer-documents/revisions", {
    method: "POST",
    body: JSON.stringify({
      companyId,
      locationId,
      documentId: documentType === "estimate" ? predecessor?.documentId || null : null,
      predecessorRevisionId: documentType === "estimate" ? predecessor?.id || null : null,
      draftId: documentType === "estimate" ? predecessor?.draftId || null : null,
      workorderId,
      documentType,
      source: { kind: "workorder", id: workorderId, expectedVersion },
      expectedFinancialFingerprint: projection.financialFingerprint,
      expectedReconciliationHash: documentType === "invoice" ? reconciliation?.reconciliationHash || null : null,
      adjustments: normalizedAdjustments(adjustments),
      recipient: {
        name: recipient?.name || null,
        company: recipient?.company || null,
        address: recipient?.address || null,
        email: recipient?.email || null,
        phone: recipient?.phone || null,
        channel: "link",
      },
      idempotencyKey,
    }),
  });
}

export async function readCustomerRevision(revisionId) {
  const result = await api(`/api/customer-documents/revisions/${encodeURIComponent(revisionId)}`);
  const revision = result.revision || result;
  const snapshot = revision.snapshot || revision.projection || {};
  return { revision, projection: customerDocumentProjection({ ...snapshot, response: revision.response || snapshot.response, eligibility: revision.eligibility || snapshot.eligibility }) };
}

export async function readCurrentDraftEstimate({ companyId, locationId, draftId }) {
  const params = new URLSearchParams({ companyId, locationId });
  const result = await api(`/api/customer-documents/drafts/${encodeURIComponent(draftId)}/current-estimate?${params}`);
  const revision = result.revision || result;
  const snapshot = revision.snapshot || revision.projection || {};
  return { revision, projection: customerDocumentProjection({ ...snapshot, response: revision.response || snapshot.response, eligibility: revision.eligibility || snapshot.eligibility }) };
}

export async function activateAcceptedEstimate({ companyId, locationId, revisionId, expectedDraftVersion }) {
  return api(`/api/customer-documents/revisions/${encodeURIComponent(revisionId)}/activate`, {
    method: "POST",
    body: JSON.stringify({ companyId, locationId, expectedDraftVersion, idempotencyKey: customerDocumentCommandKey("estimate-activate") }),
  });
}

export function customerDocumentGrantLink(rawToken, origin = window.location.origin) {
  return `${origin}/#customerDocument=${rawToken}`;
}

import { api } from "../../lib/api.js";
import { customerDocumentProjection } from "../customer-documents/customer-document-model.js";
import { customerPortalRequestHeaders } from "./customer-portal-grant.js";

export async function loadCustomerPortal(grant) {
  const result = await api("/api/customer-portal/document", { timeoutMs: 15000, headers: customerPortalRequestHeaders(grant) });
  return { ...result, document: customerDocumentProjection(result.document) };
}

export async function respondToCustomerDocument({ grant, response, customerName, note, idempotencyKey }) {
  return api("/api/customer-portal/responses", {
    method: "POST", timeoutMs: 15000,
    headers: customerPortalRequestHeaders(grant),
    body: JSON.stringify({ response, customerName, note, idempotencyKey }),
  });
}

export async function loadCustomerDocumentChat(grant) {
  return api("/api/customer-portal/chat", {
    timeoutMs: 15000,
    headers: customerPortalRequestHeaders(grant),
  });
}

export async function sendCustomerDocumentChat({ grant, body, customerName, idempotencyKey }) {
  return api("/api/customer-portal/chat", {
    method: "POST",
    timeoutMs: 15000,
    headers: customerPortalRequestHeaders(grant),
    body: JSON.stringify({ body, customerName, idempotencyKey }),
  });
}

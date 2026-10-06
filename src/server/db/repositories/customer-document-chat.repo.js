import {
  addChatMessage,
  listCustomerAudienceChatMessages,
} from "./chat.repo.js";
import { resolveCustomerDocumentGrant } from "./customer-documents.repo.js";

function domainError(code) {
  return Object.assign(new Error(code), { code });
}

function customerGrantScope(resolved) {
  const grant = resolved?.grant;
  if (!grant?.workorderId) throw domainError("CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE");
  return {
    grantId: grant.id,
    companyId: grant.companyId,
    locationId: grant.locationId,
    documentId: grant.documentId,
    revisionId: grant.revisionId,
    workorderId: grant.workorderId,
  };
}

export async function resolveCustomerDocumentChatGrant(rawToken, dependencies = {}) {
  const resolveGrant = dependencies.resolveGrant || resolveCustomerDocumentGrant;
  const resolved = await resolveGrant({ rawToken, capability: "customer_chat" });
  if (!resolved) throw domainError("CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE");
  return customerGrantScope(resolved);
}

export async function listCustomerDocumentCustomerMessages(scope, dependencies = {}) {
  const list = dependencies.listCustomerAudience || listCustomerAudienceChatMessages;
  return list(scope.workorderId, { documentId: scope.documentId, revisionId: scope.revisionId }, dependencies);
}

export async function listCustomerDocumentCustomerMessagesForGrant(rawToken, dependencies = {}) {
  const scope = await resolveCustomerDocumentChatGrant(rawToken, dependencies);
  const list = dependencies.list || listCustomerDocumentCustomerMessages;
  return { scope, messages: await list(scope, dependencies) };
}

function customerDedupeKey(scope, idempotencyKey) {
  return `customer-document:customer:${scope.grantId}:${idempotencyKey}`;
}

function staffDedupeKey(input) {
  return `customer-document:staff:${input.actorId}:${input.documentId}:${input.revisionId}:${input.idempotencyKey}`;
}

export async function appendCustomerDocumentCustomerMessage({ rawToken, body, customerName, idempotencyKey, requestHash }, dependencies = {}) {
  const scope = await resolveCustomerDocumentChatGrant(rawToken, dependencies);
  const add = dependencies.addMessage || addChatMessage;
  try {
    const message = await add({
      workorderId: scope.workorderId,
      senderUserId: null,
      senderRole: "customer",
      messageType: "normal",
      body,
      attachment: null,
      dedupeKey: customerDedupeKey(scope, idempotencyKey),
      audience: "customer",
      customerDocumentId: scope.documentId,
      customerDocumentRevisionId: scope.revisionId,
      customerDocumentAccessGrantId: scope.grantId,
      customerSenderName: customerName,
      customerRequestHash: requestHash,
    }, dependencies);
    return { message, replayed: Boolean(message.deduplicated) };
  } catch (error) {
    if (error?.code === "CHAT_MESSAGE_IDEMPOTENCY_CONFLICT") throw domainError("CUSTOMER_DOCUMENT_CHAT_IDEMPOTENCY_CONFLICT");
    if (error?.code === "42501") throw domainError("CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE");
    throw error;
  }
}

export async function appendStaffCustomerDocumentMessage(input, dependencies = {}) {
  const add = dependencies.addMessage || addChatMessage;
  try {
    const message = await add({
      workorderId: input.workorderId,
      senderUserId: input.actorId,
      senderRole: input.actorRole,
      messageType: "normal",
      body: input.body,
      attachment: null,
      dedupeKey: staffDedupeKey(input),
      audience: "customer",
      customerDocumentId: input.documentId,
      customerDocumentRevisionId: input.revisionId,
      customerDocumentAccessGrantId: null,
      customerSenderName: null,
      customerRequestHash: input.requestHash,
    }, dependencies);
    return { message, replayed: Boolean(message.deduplicated) };
  } catch (error) {
    if (error?.code === "23514") throw domainError("CUSTOMER_DOCUMENT_CHAT_SCOPE_NOT_FOUND");
    if (error?.code === "CHAT_MESSAGE_IDEMPOTENCY_CONFLICT") throw domainError("CUSTOMER_DOCUMENT_CHAT_IDEMPOTENCY_CONFLICT");
    throw error;
  }
}

import { createHash } from "node:crypto";
import { AuthError, resourceNotFound } from "../../auth/errors.js";
import { requireActor, requireCompanyAccess, requireLocationAccess, requirePermission } from "../../auth/authorize.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
import { PERMISSION } from "../../auth/permissions.js";
import * as repository from "../../db/repositories/customer-document-chat.repo.js";
import {
  customerDocumentCustomerChatMessageSchema,
  staffCustomerDocumentChatMessageSchema,
  staffCustomerDocumentChatQuerySchema,
} from "./customer-document-chat.schemas.js";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function rawGrantToken(value) {
  const token = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new AuthError(404, "CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE", "This customer discussion is unavailable.");
  }
  return token;
}

function mapPortalError(error) {
  if (["CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE", "42501"].includes(error?.code)) {
    throw new AuthError(404, "CUSTOMER_DOCUMENT_CHAT_UNAVAILABLE", "This customer discussion is unavailable.");
  }
  if (["CUSTOMER_DOCUMENT_CHAT_IDEMPOTENCY_CONFLICT", "CUSTOMER_DOCUMENT_CHAT_CONFLICT"].includes(error?.code)) {
    throw new AuthError(409, "CUSTOMER_DOCUMENT_CHAT_CONFLICT", "This message could not be saved. Reload the discussion and try again.");
  }
  throw error;
}

async function staffScope(context, input, dependencies) {
  requireActor(context);
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId);
  if (context.actor.role === "mechanic") {
    requirePermission(context, PERMISSION.WORKORDER_MECHANIC);
  } else {
    requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_WRITE);
  }
  const requireAccess = dependencies.requireWorkorderAccess || requireWorkorderAccess;
  const workorder = await requireAccess(context, input.workorderId, {
    allowAvailable: false,
    allowActiveAtLocation: false,
  });
  if (workorder.companyId !== input.companyId || workorder.locationId !== input.locationId) throw resourceNotFound("Workorder");
  return {
    ...input,
    actorId: context.actor.id,
    actorRole: context.actor.role,
    senderName: String(context.actor.displayName || context.actor.name || "Shop team").trim() || "Shop team",
  };
}

export async function readCustomerDocumentCustomerChat(rawToken, dependencies = {}) {
  try {
    const read = dependencies.read || repository.listCustomerDocumentCustomerMessagesForGrant;
    const result = await read(rawGrantToken(rawToken), dependencies);
    return { messages: result.messages };
  } catch (error) {
    return mapPortalError(error);
  }
}

export async function sendCustomerDocumentCustomerChat(rawToken, rawInput, dependencies = {}) {
  const input = customerDocumentCustomerChatMessageSchema.parse(rawInput);
  try {
    const append = dependencies.append || repository.appendCustomerDocumentCustomerMessage;
    return await append({
      rawToken: rawGrantToken(rawToken),
      ...input,
      requestHash: hash({ body: input.body, customerName: input.customerName }),
    }, dependencies);
  } catch (error) {
    return mapPortalError(error);
  }
}

export async function readStaffCustomerDocumentChat(context, workorderId, rawQuery, dependencies = {}) {
  const query = staffCustomerDocumentChatQuerySchema.parse(rawQuery);
  const scope = await staffScope(context, { ...query, workorderId }, dependencies);
  const list = dependencies.list || repository.listCustomerDocumentCustomerMessages;
  return { messages: await list(scope, dependencies) };
}

export async function sendStaffCustomerDocumentChat(context, workorderId, rawInput, dependencies = {}) {
  const input = staffCustomerDocumentChatMessageSchema.parse({ ...rawInput, workorderId });
  const command = await staffScope(context, input, dependencies);
  // Customer-visible messages are Office/Admin-owned until an explicit company
  // messaging policy is published. Mechanic Workorder access remains read-only.
  requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_WRITE);
  const append = dependencies.append || repository.appendStaffCustomerDocumentMessage;
  try {
    return await append({
      ...command,
      requestHash: hash({ body: command.body, documentId: command.documentId, revisionId: command.revisionId }),
    }, dependencies);
  } catch (error) {
    if (error?.code === "CUSTOMER_DOCUMENT_CHAT_SCOPE_NOT_FOUND") throw resourceNotFound("Customer document discussion");
    if (error?.code === "CUSTOMER_DOCUMENT_CHAT_IDEMPOTENCY_CONFLICT") {
      throw new AuthError(409, error.code, "This message could not be saved. Refresh and try again.");
    }
    throw error;
  }
}

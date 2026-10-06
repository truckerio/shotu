import { randomUUID } from "node:crypto";
import {
  activateApprovedCustomerEstimate,
  createCustomerDocumentGrant,
  issueCustomerDocument,
  previewCustomerDocument,
  publishCustomerDocumentProfile,
  readCustomerDocumentProfile,
  readCustomerPortalDocument,
  readStaffCustomerDocumentRevision,
  readStaffCurrentEstimateByDraft,
  readCustomerDocumentWorkorderSummary,
  respondToCustomerDocument,
  revokeCustomerDocumentGrant,
  voidCustomerDocument,
} from "../modules/customer-documents/customer-documents.service.js";
import { readCustomerDocumentReport } from "../modules/customer-documents/customer-document-reports.service.js";
import { emailCustomerDocumentLink } from "../modules/customer-documents/customer-document-email.service.js";
import {
  readCustomerDocumentCustomerChat,
  readStaffCustomerDocumentChat,
  sendCustomerDocumentCustomerChat,
  sendStaffCustomerDocumentChat,
} from "../modules/customer-documents/customer-document-chat.service.js";

function matchId(pathname, expression) {
  const match = expression.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function grantToken(req) {
  return req.headers?.["x-customer-grant"] || "";
}

export async function handleCustomerDocumentsApi(req, res, url, helpers, dependencies = {}) {
  const { readBody, requestContext, sendJson } = helpers;
  const preview = dependencies.preview || previewCustomerDocument;
  const publishProfile = dependencies.publishProfile || publishCustomerDocumentProfile;
  const readProfile = dependencies.readProfile || readCustomerDocumentProfile;
  const issue = dependencies.issue || issueCustomerDocument;
  const readRevision = dependencies.readRevision || readStaffCustomerDocumentRevision;
  const readByDraft = dependencies.readByDraft || readStaffCurrentEstimateByDraft;
  const readWorkorderSummary = dependencies.readWorkorderSummary || readCustomerDocumentWorkorderSummary;
  const readReport = dependencies.readReport || readCustomerDocumentReport;
  const voidRevision = dependencies.voidRevision || voidCustomerDocument;
  const issueGrant = dependencies.issueGrant || createCustomerDocumentGrant;
  const revokeGrant = dependencies.revokeGrant || revokeCustomerDocumentGrant;
  const readPortal = dependencies.readPortal || readCustomerPortalDocument;
  const respond = dependencies.respond || respondToCustomerDocument;
  const activate = dependencies.activate || activateApprovedCustomerEstimate;
  const readPortalChat = dependencies.readPortalChat || readCustomerDocumentCustomerChat;
  const sendPortalChat = dependencies.sendPortalChat || sendCustomerDocumentCustomerChat;
  const readStaffChat = dependencies.readStaffChat || readStaffCustomerDocumentChat;
  const sendStaffChat = dependencies.sendStaffChat || sendStaffCustomerDocumentChat;
  const emailLink = dependencies.emailLink || emailCustomerDocumentLink;

  if (req.method === "POST" && url.pathname === "/api/admin/customer-document-profiles") {
    sendJson(res, 201, await publishProfile(requestContext, await readBody(req)));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/customer-documents/profile") {
    sendJson(res, 200, { profile: await readProfile(requestContext, Object.fromEntries(url.searchParams)) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/customer-documents/previews") {
    sendJson(res, 200, await preview(requestContext, await readBody(req)));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/customer-documents/revisions") {
    sendJson(res, 201, await issue(requestContext, await readBody(req)));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/customer-documents/reports") {
    sendJson(res, 200, await readReport(requestContext, Object.fromEntries(url.searchParams)));
    return true;
  }
  const draftEstimateId = matchId(url.pathname, /^\/api\/customer-documents\/drafts\/([^/]+)\/current-estimate$/);
  if (req.method === "GET" && draftEstimateId) {
    sendJson(res, 200, { revision: await readByDraft(
      requestContext, draftEstimateId, Object.fromEntries(url.searchParams),
    ) });
    return true;
  }
  const summaryWorkorderId = matchId(url.pathname, /^\/api\/customer-documents\/workorders\/([^/]+)\/summary$/);
  if (req.method === "GET" && summaryWorkorderId) {
    sendJson(res, 200, await readWorkorderSummary(
      requestContext, summaryWorkorderId, Object.fromEntries(url.searchParams),
    ));
    return true;
  }
  const customerChatWorkorderId = matchId(url.pathname, /^\/api\/customer-documents\/workorders\/([^/]+)\/customer-chat$/);
  if (req.method === "GET" && customerChatWorkorderId) {
    sendJson(res, 200, await readStaffChat(
      requestContext, customerChatWorkorderId, Object.fromEntries(url.searchParams),
    ));
    return true;
  }
  if (req.method === "POST" && customerChatWorkorderId) {
    sendJson(res, 201, await sendStaffChat(requestContext, customerChatWorkorderId, await readBody(req)));
    return true;
  }

  const revisionId = matchId(url.pathname, /^\/api\/customer-documents\/revisions\/([^/]+)$/);
  if (req.method === "GET" && revisionId) {
    sendJson(res, 200, { revision: await readRevision(requestContext, revisionId) });
    return true;
  }
  const voidId = matchId(url.pathname, /^\/api\/customer-documents\/revisions\/([^/]+)\/void$/);
  if (req.method === "POST" && voidId) {
    sendJson(res, 200, await voidRevision(requestContext, voidId, await readBody(req)));
    return true;
  }
  const activateId = matchId(url.pathname, /^\/api\/customer-documents\/revisions\/([^/]+)\/activate$/);
  if (req.method === "POST" && activateId) {
    sendJson(res, 201, await activate(requestContext, activateId, await readBody(req)));
    return true;
  }
  const grantRevisionId = matchId(url.pathname, /^\/api\/customer-documents\/revisions\/([^/]+)\/grants$/);
  if (req.method === "POST" && grantRevisionId) {
    const body = await readBody(req);
    sendJson(res, 201, await issueGrant(requestContext, { ...body, revisionId: grantRevisionId }));
    return true;
  }
  const grantId = matchId(url.pathname, /^\/api\/customer-documents\/grants\/([^/]+)\/revoke$/);
  if (req.method === "POST" && grantId) {
    sendJson(res, 200, await revokeGrant(requestContext, grantId, await readBody(req)));
    return true;
  }
  const emailGrantId = matchId(url.pathname, /^\/api\/customer-documents\/grants\/([^/]+)\/email$/);
  if (req.method === "POST" && emailGrantId) {
    sendJson(res, 200, await emailLink(requestContext, emailGrantId, await readBody(req)));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/customer-portal/document") {
    sendJson(res, 200, await readPortal(grantToken(req), {
      idempotencyKey: `view:${req.requestId || req.headers?.["x-request-id"] || randomUUID()}`,
    }));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/customer-portal/responses") {
    sendJson(res, 200, await respond(grantToken(req), await readBody(req)));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/customer-portal/chat") {
    sendJson(res, 200, await readPortalChat(grantToken(req)));
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/customer-portal/chat") {
    sendJson(res, 201, await sendPortalChat(grantToken(req), await readBody(req)));
    return true;
  }
  return false;
}

import {
  addOfficePart,
  assignOfficeWorkorderMechanics,
  closeOfficeWorkorder,
  createOfficeWorkorder,
  officeDashboard,
  officeLocationMechanics,
  officeWorkorderDetail,
  reviewOfficePartRequest,
  reassignOfficeWorkorder,
  sendOfficeMessage,
  changeOfficePartAllocation,
  updateOfficeWorkorder,
} from "../modules/office/office.service.js";
import { createOfficePartSchema, decidePartRequestSchema, updatePartAllocationSchema } from "../modules/parts/part.schemas.js";
import {
  assignMechanicsSchema,
  closeWorkorderSchema,
  createWorkorderSchema,
  reassignWorkorderSchema,
  sendMessageSchema,
  updateOfficeWorkorderSchema,
} from "../modules/workorders/workorder.schemas.js";
import { requireWorkorderAccess } from "../auth/resource-access.js";
import { requireCompanyAccess, requireLocationAccess } from "../auth/authorize.js";
import { getLocationTemplates } from "../db/repositories/templates.repo.js";
import { recordWorkorderOpen } from "../modules/workorders/workorder-detail.service.js";
import { acknowledgeChatReceiptsSchema } from "../modules/chat/chat-receipts.schemas.js";
import { acknowledgeChatReceipts } from "../modules/chat/chat-receipts.service.js";

function workorderIdFrom(pathname, suffix = "") {
  const escapedSuffix = suffix ? suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const match = new RegExp(`^/api/office/workorders/([^/]+)${escapedSuffix}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function partDecisionPath(pathname) {
  const match = /^\/api\/office\/workorders\/([^/]+)\/parts\/([^/]+)\/decision$/.exec(pathname);
  return match ? { workorderId: decodeURIComponent(match[1]), requestId: decodeURIComponent(match[2]) } : null;
}

function allocationPath(pathname) {
  const match = /^\/api\/office\/workorders\/([^/]+)\/parts\/([^/]+)\/allocations\/([^/]+)$/.exec(pathname);
  return match ? {
    workorderId: decodeURIComponent(match[1]),
    requestId: decodeURIComponent(match[2]),
    allocationId: decodeURIComponent(match[3]),
  } : null;
}

function officePartsPath(pathname) {
  const match = /^\/api\/office\/workorders\/([^/]+)\/parts$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function locationMechanicsPath(pathname) {
  const match = /^\/api\/office\/locations\/([^/]+)\/mechanics$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function handleOfficeApi(req, res, url, helpers) {
  const { sendJson, readBody, requestContext } = helpers;
  const officeUserId = requestContext.actor.id;

  if (req.method === "GET" && url.pathname === "/api/office/template") {
    const rows = await getLocationTemplates(requestContext.actor.locationIds || []);
    const locations = rows.map((row) => ({
      location: {
        id: row.location_id,
        company_id: row.company_id,
        name: row.location_name,
        type: row.location_type,
        address: row.location_address,
      },
      template: row.id ? {
        id: row.id,
        location_id: row.location_id,
        header_title: row.header_title,
        brand_top: row.brand_top,
        brand_bottom: row.brand_bottom,
        warranty_text: row.warranty_text,
        responsibility_text: row.responsibility_text,
        authorization_text: row.authorization_text,
        active: row.active,
        version: row.version,
        updated_at: row.updated_at,
      } : null,
    }));
    sendJson(res, 200, { locations, ...(locations[0] || { location: null, template: null }) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/office/dashboard") {
    sendJson(res, 200, await officeDashboard(requestContext));
    return true;
  }

  const mechanicsLocationId = locationMechanicsPath(url.pathname);
  if (req.method === "GET" && mechanicsLocationId) {
    requireLocationAccess(requestContext, mechanicsLocationId);
    sendJson(res, 200, {
      mechanics: await officeLocationMechanics(mechanicsLocationId, officeUserId),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/office/workorders") {
    const input = createWorkorderSchema.parse(await readBody(req));
    requireCompanyAccess(requestContext, input.companyId);
    requireLocationAccess(requestContext, input.locationId);
    sendJson(res, 200, { workorder: await createOfficeWorkorder({ ...input, createdByUserId: officeUserId }) });
    return true;
  }

  const detailId = workorderIdFrom(url.pathname);
  if (req.method === "GET" && detailId) {
    await requireWorkorderAccess(requestContext, detailId);
    sendJson(res, 200, await officeWorkorderDetail(detailId, officeUserId));
    return true;
  }

  const openedId = workorderIdFrom(url.pathname, "/opened");
  if (req.method === "POST" && openedId) {
    await requireWorkorderAccess(requestContext, openedId);
    await recordWorkorderOpen(openedId, requestContext.actor);
    sendJson(res, 200, { recorded: true });
    return true;
  }

  if (req.method === "PATCH" && detailId) {
    await requireWorkorderAccess(requestContext, detailId);
    const input = updateOfficeWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await updateOfficeWorkorder(detailId, { ...input, officeUserId }) });
    return true;
  }

  const officePartsId = officePartsPath(url.pathname);
  if (req.method === "POST" && officePartsId) {
    await requireWorkorderAccess(requestContext, officePartsId);
    const input = createOfficePartSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await addOfficePart(officePartsId, { ...input, officeUserId }) });
    return true;
  }

  const decisionRoute = partDecisionPath(url.pathname);
  if (req.method === "POST" && decisionRoute) {
    await requireWorkorderAccess(requestContext, decisionRoute.workorderId);
    const input = decidePartRequestSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await reviewOfficePartRequest(decisionRoute.workorderId, decisionRoute.requestId, { ...input, officeUserId }) });
    return true;
  }

  const allocationRoute = allocationPath(url.pathname);
  if (req.method === "PATCH" && allocationRoute) {
    await requireWorkorderAccess(requestContext, allocationRoute.workorderId);
    const input = updatePartAllocationSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await changeOfficePartAllocation(
      allocationRoute.workorderId,
      allocationRoute.requestId,
      allocationRoute.allocationId,
      { ...input, officeUserId },
    ) });
    return true;
  }

  const messageId = workorderIdFrom(url.pathname, "/messages");
  if (req.method === "POST" && messageId) {
    await requireWorkorderAccess(requestContext, messageId);
    const input = sendMessageSchema.parse({ ...(await readBody(req)), messageType: "normal" });
    sendJson(res, 200, { message: await sendOfficeMessage(messageId, { ...input, senderUserId: officeUserId, senderRole: "office" }) });
    return true;
  }

  const receiptWorkorderId = workorderIdFrom(url.pathname, "/message-receipts");
  if (req.method === "POST" && receiptWorkorderId) {
    await requireWorkorderAccess(requestContext, receiptWorkorderId);
    const input = acknowledgeChatReceiptsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      receipt: await acknowledgeChatReceipts({
        workorderId: receiptWorkorderId,
        actorUserId: officeUserId,
        ...input,
      }),
    });
    return true;
  }

  const closeId = workorderIdFrom(url.pathname, "/close");
  if (req.method === "POST" && closeId) {
    await requireWorkorderAccess(requestContext, closeId);
    const input = closeWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await closeOfficeWorkorder(closeId, { ...input, officeUserId }) });
    return true;
  }

  const reassignId = workorderIdFrom(url.pathname, "/reassign");
  if (req.method === "POST" && reassignId) {
    await requireWorkorderAccess(requestContext, reassignId);
    const input = reassignWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await reassignOfficeWorkorder(reassignId, { ...input, officeUserId }) });
    return true;
  }

  const assignmentsId = workorderIdFrom(url.pathname, "/assignments");
  if (req.method === "POST" && assignmentsId) {
    await requireWorkorderAccess(requestContext, assignmentsId);
    const input = assignMechanicsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      workorder: await assignOfficeWorkorderMechanics(assignmentsId, { ...input, officeUserId }),
    });
    return true;
  }

  return false;
}

import {
  acceptMechanicWorkorder,
  createMechanicWorkorder,
  markMechanicDone,
  mechanicDashboard,
  mechanicWorkorderDetail,
  releaseMechanicWorkorder,
  requestMechanicPart,
  saveMechanicWorkorderProgress,
  saveMechanicUsedParts,
  sendMechanicMessage,
  updateMechanicPartUsage,
} from "../modules/mechanic/mechanic.service.js";
import { createPartRequestSchema, updatePartUsageSchema } from "../modules/parts/part.schemas.js";
import {
  acceptWorkorderSchema,
  createWorkorderSchema,
  markDoneSchema,
  releaseWorkorderSchema,
  sendMessageSchema,
  updateMechanicUsedPartsSchema,
} from "../modules/workorders/workorder.schemas.js";
import { mechanicProgressSchema } from "../modules/mechanic/mechanic-progress.schemas.js";
import { getChatAttachmentById } from "../db/repositories/chat.repo.js";
import { getLocationTemplates } from "../db/repositories/templates.repo.js";
import { readStoredChatImage } from "../modules/chat/chat-media.service.js";
import { requireCompanyAccess, requireLocationAccess } from "../auth/authorize.js";
import { requireWorkorderAccess } from "../auth/resource-access.js";
import { recordWorkorderOpen } from "../modules/workorders/workorder-detail.service.js";
import { acknowledgeChatReceiptsSchema } from "../modules/chat/chat-receipts.schemas.js";
import { acknowledgeChatReceipts } from "../modules/chat/chat-receipts.service.js";

function workorderIdFrom(pathname, suffix = "") {
  const escapedSuffix = suffix ? suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const match = new RegExp(`^/api/mechanic/workorders/([^/]+)${escapedSuffix}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function partPath(pathname) {
  const match = /^\/api\/mechanic\/workorders\/([^/]+)\/parts(?:\/([^/]+)\/usage)?$/.exec(pathname);
  return match ? { workorderId: decodeURIComponent(match[1]), requestId: match[2] ? decodeURIComponent(match[2]) : null } : null;
}

function chatMediaIdFrom(pathname) {
  const match = /^\/api\/mechanic\/chat-media\/([0-9a-f-]{36})$/.exec(pathname);
  return match ? match[1] : null;
}

export async function handleMechanicApi(req, res, url, helpers) {
  const { sendJson, readBody, requestContext } = helpers;
  const mechanicUserId = requestContext.actor.id;

  const mediaId = chatMediaIdFrom(url.pathname);
  if (req.method === "GET" && mediaId) {
    const attachment = await getChatAttachmentById(mediaId);
    if (!attachment) {
      sendJson(res, 404, { error: "Chat attachment not found." });
      return true;
    }
    await requireWorkorderAccess(requestContext, attachment.workorderId);
    let body;
    try {
      body = await readStoredChatImage(attachment.storageKey);
    } catch (error) {
      if (error.code === "ENOENT") {
        sendJson(res, 404, { error: "Chat attachment file not found." });
        return true;
      }
      throw error;
    }
    res.writeHead(200, {
      "content-type": attachment.mimeType,
      "content-length": body.length,
      "content-disposition": `inline; filename="${attachment.fileName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mechanic/dashboard") {
    sendJson(res, 200, await mechanicDashboard(mechanicUserId, requestContext));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/mechanic/template") {
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
        location_id: row.template_location_id,
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

  if (req.method === "POST" && url.pathname === "/api/mechanic/workorders") {
    const input = createWorkorderSchema.parse(await readBody(req));
    requireCompanyAccess(requestContext, input.companyId);
    requireLocationAccess(requestContext, input.locationId);
    sendJson(res, 200, { workorder: await createMechanicWorkorder({ ...input, createdByUserId: mechanicUserId }) });
    return true;
  }

  const detailId = workorderIdFrom(url.pathname);
  if (req.method === "GET" && detailId) {
    await requireWorkorderAccess(requestContext, detailId, { allowAvailable: true, allowActiveAtLocation: true });
    sendJson(res, 200, await mechanicWorkorderDetail(detailId, mechanicUserId));
    return true;
  }

  const openedId = workorderIdFrom(url.pathname, "/opened");
  if (req.method === "POST" && openedId) {
    await requireWorkorderAccess(requestContext, openedId, { allowAvailable: true, allowActiveAtLocation: true });
    await recordWorkorderOpen(openedId, requestContext.actor);
    sendJson(res, 200, { recorded: true });
    return true;
  }

  const partRoute = partPath(url.pathname);
  if (req.method === "POST" && partRoute && !partRoute.requestId) {
    await requireWorkorderAccess(requestContext, partRoute.workorderId);
    const input = createPartRequestSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await requestMechanicPart(partRoute.workorderId, { ...input, mechanicUserId }) });
    return true;
  }

  if (req.method === "PATCH" && partRoute?.requestId) {
    await requireWorkorderAccess(requestContext, partRoute.workorderId);
    const input = updatePartUsageSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await updateMechanicPartUsage(partRoute.workorderId, partRoute.requestId, { ...input, mechanicUserId }) });
    return true;
  }

  const acceptId = workorderIdFrom(url.pathname, "/accept");
  if (req.method === "POST" && acceptId) {
    await requireWorkorderAccess(requestContext, acceptId, { allowAvailable: true, allowActiveAtLocation: true });
    const input = acceptWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await acceptMechanicWorkorder(acceptId, mechanicUserId) });
    return true;
  }

  const releaseId = workorderIdFrom(url.pathname, "/release");
  if (req.method === "POST" && releaseId) {
    await requireWorkorderAccess(requestContext, releaseId);
    const input = releaseWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await releaseMechanicWorkorder(releaseId, mechanicUserId, input.reason) });
    return true;
  }

  const progressId = workorderIdFrom(url.pathname, "/progress");
  if (req.method === "PATCH" && progressId) {
    await requireWorkorderAccess(requestContext, progressId);
    const parsed = mechanicProgressSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { error: "Invalid mechanic progress.", issues: parsed.error.issues });
      return true;
    }
    const input = parsed.data;
    const progress = await saveMechanicWorkorderProgress(progressId, mechanicUserId, input);
    sendJson(res, 200, {
      progress,
      version: progress.version,
      savedAt: progress.savedAt,
    });
    return true;
  }

  const usedPartsId = workorderIdFrom(url.pathname, "/used-parts");
  if (req.method === "PATCH" && usedPartsId) {
    await requireWorkorderAccess(requestContext, usedPartsId);
    const input = updateMechanicUsedPartsSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await saveMechanicUsedParts(usedPartsId, mechanicUserId, input.parts) });
    return true;
  }

  const doneId = workorderIdFrom(url.pathname, "/mark-done");
  if (req.method === "POST" && doneId) {
    await requireWorkorderAccess(requestContext, doneId);
    const input = markDoneSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await markMechanicDone(doneId, mechanicUserId, input) });
    return true;
  }

  const messageId = workorderIdFrom(url.pathname, "/messages");
  if (req.method === "POST" && messageId) {
    await requireWorkorderAccess(requestContext, messageId);
    const input = sendMessageSchema.parse(await readBody(req));
    const result = await sendMechanicMessage(messageId, { ...input, senderUserId: mechanicUserId, senderRole: "mechanic" });
    sendJson(res, 200, {
      ...result,
      reloadUrl: `/api/mechanic/workorders/${encodeURIComponent(messageId)}`,
    });
    return true;
  }

  const receiptWorkorderId = workorderIdFrom(url.pathname, "/message-receipts");
  if (req.method === "POST" && receiptWorkorderId) {
    await requireWorkorderAccess(requestContext, receiptWorkorderId);
    const input = acknowledgeChatReceiptsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      receipt: await acknowledgeChatReceipts({
        workorderId: receiptWorkorderId,
        actorUserId: mechanicUserId,
        ...input,
      }),
    });
    return true;
  }

  return false;
}

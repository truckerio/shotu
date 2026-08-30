import {
  officeDashboard,
  officeLocationMechanics,
  officeWorkorderDetail,
} from "../modules/office/office.service.js";
import { createOfficePartSchema, decidePartRequestSchema, updatePartAllocationSchema } from "../modules/parts/part.schemas.js";
import { loadUnresolvedPartRequestQueue } from "../modules/parts/part-request-queue.service.js";
import {
  assignMechanicsSchema,
  cancelWorkorderSchema,
  closeWorkorderSchema,
  createWorkorderSchema,
  markDoneSchema,
  reassignWorkorderSchema,
  returnWorkorderSchema,
  sendMessageSchema,
  updateMechanicUsedPartsSchema,
  updateOfficeWorkorderSchema,
} from "../modules/workorders/workorder.schemas.js";
import { requireWorkorderAccess } from "../auth/resource-access.js";
import { requireLocationAccess } from "../auth/authorize.js";
import { loadOfficeLocationTemplates } from "../modules/office/office-template-scope.js";
import { recordWorkorderOpen } from "../modules/workorders/workorder-detail.service.js";
import { acknowledgeChatReceiptsSchema } from "../modules/chat/chat-receipts.schemas.js";
import { normalizeModuleAccessMap, normalizeUserModuleAccessMap } from "../../../shared/workorder-modules.js";
import { resolveWorkorderModuleDecisions } from "../modules/workorders/workorder-module-access.service.js";
import {
  createWorkorderRuntime,
  patchWorkorderModules,
  projectLoadedProtectedWorkorderDetail,
  runWorkorderModuleAction,
} from "../modules/workorders/workorder-module-runtime.service.js";

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

function officeUsedPartsPath(pathname) {
  const match = /^\/api\/office\/workorders\/([^/]+)\/used-parts$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function locationMechanicsPath(pathname) {
  const match = /^\/api\/office\/locations\/([^/]+)\/mechanics$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function locationWorkorderPolicy(row) {
  return {
    locationId: row.location_id,
    companyId: row.company_id,
    mechanicCanRecordParts: row.policy_mechanic_can_record_parts === true,
    moduleAccess: normalizeModuleAccessMap(row.policy_module_access || {}),
    userModuleAccess: normalizeUserModuleAccessMap(row.policy_user_module_access || {}),
  };
}

export async function handleOfficeApi(req, res, url, helpers, dependencies = {}) {
  const { sendJson, readBody, requestContext } = helpers;
  const officeUserId = requestContext.actor.id;
  const resolveModules = dependencies.resolveModules || resolveWorkorderModuleDecisions;
  const createRuntime = dependencies.createRuntime || createWorkorderRuntime;
  const patchModules = dependencies.patchModules || patchWorkorderModules;
  const runAction = dependencies.runAction || runWorkorderModuleAction;
  const loadPartRequestQueue = dependencies.loadPartRequestQueue || loadUnresolvedPartRequestQueue;
  const loadDetail = dependencies.loadDetail || officeWorkorderDetail;

  if (req.method === "GET" && url.pathname === "/api/office/template") {
    const rows = await loadOfficeLocationTemplates(requestContext);
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
      policy: locationWorkorderPolicy(row),
    }));
    sendJson(res, 200, { locations, ...(locations[0] || { location: null, template: null }) });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/office/dashboard") {
    sendJson(res, 200, await officeDashboard(requestContext));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/office/part-requests/queue") {
    sendJson(res, 200, await loadPartRequestQueue(Object.fromEntries(url.searchParams), requestContext));
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
    const rawInput = await readBody(req);
    const input = createWorkorderSchema.parse(rawInput);
    sendJson(res, 200, { workorder: await createRuntime(requestContext, input, rawInput) });
    return true;
  }

  const detailId = workorderIdFrom(url.pathname);
  if (req.method === "GET" && detailId) {
    const { decisions } = await resolveModules(requestContext, detailId);
    sendJson(res, 200, await projectLoadedProtectedWorkorderDetail(
      await loadDetail(detailId, officeUserId),
      decisions,
      { viewerRole: requestContext.actor.role },
      dependencies,
    ));
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
    const rawInput = await readBody(req);
    const input = updateOfficeWorkorderSchema.parse(rawInput);
    const moduleKeys = [
      ["unit", ["assetId", "customerCompanyName", "companyName", "unitNo", "unitType", "licenseNo", "mileage", "model", "vinNo"]],
      ["location", ["locationId"]],
      ["schedule", ["workStartDate", "workEndDate", "startTime", "endTime"]],
      ["assignment", ["mechanicName", "customerSignature", "authorizedBy"]],
      ["concern", ["concern", "officeNotes", "mechanicConcern"]],
    ].filter(([, keys]) => keys.some((key) => Object.hasOwn(rawInput, key) || Object.hasOwn(rawInput.formData || {}, key)));
    sendJson(res, 200, { workorder: await patchModules(
      requestContext, detailId, moduleKeys.map(([moduleKey]) => moduleKey), input,
    ) });
    return true;
  }

  const officeUsedPartsId = officeUsedPartsPath(url.pathname);
  if (req.method === "PATCH" && officeUsedPartsId) {
    const input = updateMechanicUsedPartsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      workorder: await runAction(requestContext, officeUsedPartsId, "parts", "record", {
        operation: "usedParts", ...input,
      }),
    });
    return true;
  }

  const officePartsId = officePartsPath(url.pathname);
  if (req.method === "POST" && officePartsId) {
    const input = createOfficePartSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await runAction(requestContext, officePartsId, "parts", "record", {
      operation: "officePart", ...input,
    }) });
    return true;
  }

  const decisionRoute = partDecisionPath(url.pathname);
  if (req.method === "POST" && decisionRoute) {
    const input = decidePartRequestSchema.parse(await readBody(req));
    const action = input.decision === "rejected" ? "decline" : "approve";
    sendJson(res, 200, { partRequest: await runAction(requestContext, decisionRoute.workorderId, "parts", action, {
      ...input, requestId: decisionRoute.requestId,
    }) });
    return true;
  }

  const allocationRoute = allocationPath(url.pathname);
  if (req.method === "PATCH" && allocationRoute) {
    const input = updatePartAllocationSchema.parse(await readBody(req));
    sendJson(res, 200, { partRequest: await runAction(requestContext, allocationRoute.workorderId, "parts", "allocate", {
      ...input, requestId: allocationRoute.requestId, allocationId: allocationRoute.allocationId,
    }) });
    return true;
  }

  const messageId = workorderIdFrom(url.pathname, "/messages");
  if (req.method === "POST" && messageId) {
    const input = sendMessageSchema.parse({ ...(await readBody(req)), messageType: "normal" });
    sendJson(res, 200, { message: await runAction(
      requestContext, messageId, "chat", input.attachment ? "attach" : "send", input,
    ) });
    return true;
  }

  const receiptWorkorderId = workorderIdFrom(url.pathname, "/message-receipts");
  if (req.method === "POST" && receiptWorkorderId) {
    const input = acknowledgeChatReceiptsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      receipt: await runAction(requestContext, receiptWorkorderId, "chat", "acknowledge", input),
    });
    return true;
  }

  const closeId = workorderIdFrom(url.pathname, "/close");
  if (req.method === "POST" && closeId) {
    const input = closeWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await runAction(requestContext, closeId, "completion", "close", input) });
    return true;
  }

  const doneId = workorderIdFrom(url.pathname, "/mark-done");
  if (req.method === "POST" && doneId) {
    const input = markDoneSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await runAction(requestContext, doneId, "completion", "markWorkDone", input) });
    return true;
  }

  const returnId = workorderIdFrom(url.pathname, "/return");
  if (req.method === "POST" && returnId) {
    const parsed = returnWorkorderSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.issues[0]?.message || "Enter a valid return reason." });
      return true;
    }
    sendJson(res, 200, { workorder: await runAction(requestContext, returnId, "completion", "requestChanges", parsed.data) });
    return true;
  }

  const cancelId = workorderIdFrom(url.pathname, "/cancel");
  if (req.method === "POST" && cancelId) {
    const parsed = cancelWorkorderSchema.safeParse(await readBody(req));
    if (!parsed.success) {
      sendJson(res, 400, { error: parsed.error.issues[0]?.message || "Enter a valid cancellation reason." });
      return true;
    }
    sendJson(res, 200, { workorder: await runAction(requestContext, cancelId, "completion", "cancel", parsed.data) });
    return true;
  }

  const reassignId = workorderIdFrom(url.pathname, "/reassign");
  if (req.method === "POST" && reassignId) {
    const input = reassignWorkorderSchema.parse(await readBody(req));
    sendJson(res, 200, { workorder: await runAction(requestContext, reassignId, "assignment", "reassign", input) });
    return true;
  }

  const assignmentsId = workorderIdFrom(url.pathname, "/assignments");
  if (req.method === "POST" && assignmentsId) {
    const input = assignMechanicsSchema.parse(await readBody(req));
    sendJson(res, 200, {
      workorder: await runAction(requestContext, assignmentsId, "assignment", "assign", input),
    });
    return true;
  }

  return false;
}

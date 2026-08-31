import { AuthError, invalidRequest, permissionDenied } from "../../auth/errors.js";
import { acknowledgeChatReceipts } from "../chat/chat-receipts.service.js";
import {
  acceptMechanicWorkorder,
  markMechanicDone,
  releaseMechanicWorkorder,
  requestMechanicPart,
  saveMechanicUsedParts,
  saveMechanicWorkorderProgress,
  sendMechanicMessage,
  updateMechanicPartUsage,
} from "../mechanic/mechanic.service.js";
import {
  addOfficePart,
  amendOfficeManualPartEvidence,
  assignOfficeWorkorderMechanics,
  cancelOfficeWorkorder,
  changeOfficePartAllocation,
  closeOfficeWorkorder,
  reassignOfficeWorkorder,
  returnOfficeWorkorder,
  reviewOfficePartRequest,
  saveOfficeUsedParts,
  sendOfficeMessage,
  updateOfficeWorkorder,
  markOfficeWorkorderDone,
  planOfficePart,
} from "../office/office.service.js";
import { loadWorkorderDetail } from "./workorder-detail.service.js";
import {
  createOperationalWorkorder,
  mapActiveAssetConflict,
  WorkorderLifecycleConflictError,
} from "../../db/repositories/operational-workorders.repo.js";
import { getAuthorizedLocationTemplates } from "../../db/repositories/templates.repo.js";
import { listUsersByLocation } from "../../db/repositories/users.repo.js";
import { getConfiguredLaborProduct } from "../../db/repositories/labor-product.repo.js";
import { listOfficialInstalledSerializedParts } from "../../print/workorder-print-projection.js";
import { requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import {
  authorizeWorkorderModule,
  authorizeWorkorderModuleActions,
  authorizeWorkorderCreate,
  resolveWorkorderModuleDecisions,
} from "./workorder-module-access.service.js";
import { projectProtectedWorkorderDetail, workorderInputModules } from "./workorder-module-projection.js";
import {
  createWorkorderOdooDraft,
  mapWorkorderOdooPart,
  markWorkorderOdooMissingInfo,
  prepareWorkorderOdooModule,
  workorderOdooReadiness,
} from "./workorder-odoo-module.service.js";
import { readUnitServiceHistory } from "./unit-service-history.service.js";
import { updateSerializedUsageRepairOrderForWorkorder } from "../inventory/inventory-unit-workorder.service.js";
import {
  releaseOrReverseMeasuredUsageForWorkorder,
  reserveMeasuredUsageForWorkorder,
} from "../inventory/inventory-aggregate-workorder.service.js";
import { listAggregateWorkorderUsages } from "../../db/repositories/inventory-aggregate-workorder-usage.repo.js";
import {
  applyManualPartEvidence,
  listWorkorderManualPartEvidence,
} from "../../db/repositories/workorder-manual-part-evidence.repo.js";

function resourceOptions(context) {
  return context.actor.role === "mechanic"
    ? { allowAvailable: true, allowActiveAtLocation: true }
    : {};
}

async function withInstalledSerializedParts(detail, decisions, dependencies) {
  if (!decisions?.parts || decisions.parts.access === "hidden") return detail;
  const listInstalledParts = dependencies.listInstalledParts || listOfficialInstalledSerializedParts;
  const listMeasuredParts = dependencies.listAggregateUsages || listAggregateWorkorderUsages;
  const listManualEvidence = dependencies.listManualPartEvidence || listWorkorderManualPartEvidence;
  const formData = detail.workorder.formData || {};
  const hasManualEvidence = Array.isArray(formData.parts)
    && formData.parts.some((part) => part?.evidenceId);
  const [installedSerializedParts, aggregatePartUsages, manualPartEvidence] = await Promise.all([
    listInstalledParts({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      limit: 2000,
    }),
    listMeasuredParts({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      limit: 200,
    }),
    hasManualEvidence ? listManualEvidence({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      limit: 100,
    }) : [],
  ]);
  return {
    ...detail,
    workorder: {
      ...detail.workorder,
      formData: {
        ...formData,
        parts: applyManualPartEvidence(formData.parts, manualPartEvidence),
      },
    },
    installedSerializedParts,
    aggregatePartUsages,
  };
}

export async function projectLoadedProtectedWorkorderDetail(
  detail,
  decisions,
  options = {},
  dependencies = {},
) {
  const enriched = await withInstalledSerializedParts(detail, decisions, dependencies);
  return projectProtectedWorkorderDetail(enriched, decisions, options);
}

export async function protectedWorkorderDetail(context, workorderId, dependencies = {}) {
  const resolveModules = dependencies.resolveModules || resolveWorkorderModuleDecisions;
  const loadDetail = dependencies.loadDetail || loadWorkorderDetail;
  const { decisions } = await resolveModules(context, workorderId, {
    resourceAccess: resourceOptions(context),
  });
  const loadedDetail = await loadDetail(workorderId, {
    viewerUserId: context.actor.id,
    participantChatOnly: context.actor.role === "mechanic",
  });
  return projectLoadedProtectedWorkorderDetail(
    loadedDetail,
    decisions,
    { viewerRole: context.actor.role },
    dependencies,
  );
}

export async function protectedWorkorderModule(context, workorderId, moduleKey, dependencies = {}) {
  const authorize = dependencies.authorize || authorizeWorkorderModule;
  const loadDetail = dependencies.loadDetail || loadWorkorderDetail;
  const authorization = await authorize(context, workorderId, {
    moduleKey,
    capability: "read",
    resourceAccess: resourceOptions(context),
  });
  const loadedDetail = await loadDetail(workorderId, {
    viewerUserId: context.actor.id,
    participantChatOnly: context.actor.role === "mechanic",
  });
  const decisions = { [moduleKey]: { access: authorization.access, source: authorization.source } };
  return projectLoadedProtectedWorkorderDetail(
    loadedDetail,
    decisions,
    { viewerRole: context.actor.role },
    dependencies,
  );
}

export async function patchWorkorderModule(context, workorderId, moduleKey, input, dependencies = {}) {
  const authorize = dependencies.authorize || authorizeWorkorderModule;
  await authorize(context, workorderId, { moduleKey, capability: "write", action: "update" });
  if (["unit", "location", "schedule", "assignment", "concern"].includes(moduleKey)) {
    const update = dependencies.updateOffice || updateOfficeWorkorder;
    return update(workorderId, { ...input, officeUserId: context.actor.id });
  }
  if (moduleKey === "diagnosisRepair") {
    if (["office", "admin"].includes(context.actor.role)) {
      const update = dependencies.updateOffice || updateOfficeWorkorder;
      return update(workorderId, { ...input, officeUserId: context.actor.id });
    }
    const update = dependencies.updateMechanic || saveMechanicWorkorderProgress;
    return update(workorderId, context.actor.id, input);
  }
  throw permissionDenied();
}

export async function patchWorkorderModules(context, workorderId, moduleKeys, input, dependencies = {}) {
  if (!moduleKeys.length) throw invalidRequest("No writable module fields were provided.");
  const authorizeMany = dependencies.authorizeMany || authorizeWorkorderModuleActions;
  await authorizeMany(context, workorderId, moduleKeys.map((moduleKey) => ({
    moduleKey,
    capability: "write",
    action: "update",
  })));
  const update = dependencies.updateOffice || updateOfficeWorkorder;
  return update(workorderId, { ...input, officeUserId: context.actor.id });
}

export async function runWorkorderModuleAction(
  context,
  workorderId,
  moduleKey,
  action,
  input,
  dependencies = {},
) {
  const authorize = dependencies.authorize || authorizeWorkorderModule;
  const isMechanicPartRequest = moduleKey === "parts" && action === "request";
  if (isMechanicPartRequest && context.actor.role !== "mechanic") throw permissionDenied();
  const authorization = await authorize(context, workorderId, {
    moduleKey,
    capability: isMechanicPartRequest ? "read" : "write",
    action,
    resourceAccess: action === "accept" ? resourceOptions(context) : {},
  });
  if (moduleKey === "parts"
    && action === "record"
    && input.operation === "usedParts"
    && Object.prototype.hasOwnProperty.call(input, "laborHours")) {
    await authorize(context, workorderId, {
      moduleKey: "diagnosisRepair",
      capability: "write",
      action: "update",
    });
  }
  const actorId = context.actor.id;

  if (moduleKey === "assignment") {
    if (action === "accept") {
      if (context.actor.role !== "mechanic") throw permissionDenied();
      return (dependencies.accept || acceptMechanicWorkorder)(workorderId, actorId);
    }
    if (action === "release") return (dependencies.release || releaseMechanicWorkorder)(workorderId, actorId, input.reason);
    if (action === "assign") return (dependencies.assign || assignOfficeWorkorderMechanics)(workorderId, { ...input, officeUserId: actorId });
    if (action === "reassign") return (dependencies.reassign || reassignOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId });
  }

  if (moduleKey === "parts") {
    if (action === "request") return (dependencies.requestPart || requestMechanicPart)(workorderId, { ...input, mechanicUserId: actorId });
    if (action === "record" && input.operation === "usedParts") {
      return context.actor.role === "mechanic"
        ? (dependencies.saveMechanicParts || saveMechanicUsedParts)(workorderId, actorId, input.parts, input.laborHours)
        : (dependencies.saveOfficeParts || saveOfficeUsedParts)(workorderId, {
          parts: input.parts,
          laborHours: input.laborHours,
          officeUserId: actorId,
        });
    }
    if (action === "record" && input.operation === "legacyManualPartAmendment") {
      if (!["office", "admin"].includes(context.actor.role)) throw permissionDenied();
      return (dependencies.amendManualPartEvidence || amendOfficeManualPartEvidence)(workorderId, {
        evidenceId: input.evidenceId,
        action: input.action,
        replacementPart: input.replacementPart,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        officeUserId: actorId,
        companyId: authorization.companyId,
        locationId: authorization.locationId,
      });
    }
    if (action === "record" && input.operation === "usage" && context.actor.role === "mechanic") {
      return (dependencies.updateUsage || updateMechanicPartUsage)(workorderId, input.requestId, { ...input, mechanicUserId: actorId });
    }
    if (action === "record" && input.operation === "officePart" && ["office", "admin"].includes(context.actor.role)) {
      return (dependencies.addOfficePart || addOfficePart)(workorderId, { ...input, officeUserId: actorId });
    }
    if (action === "record" && input.operation === "officePartPlan" && ["office", "admin"].includes(context.actor.role)) {
      return (dependencies.planOfficePart || planOfficePart)(workorderId, { ...input, officeUserId: actorId });
    }
    if (action === "record" && input.operation === "serializedUsageRepairOrder") {
      return (dependencies.updateSerializedRepairOrderForWorkorder || updateSerializedUsageRepairOrderForWorkorder)(
        workorderId,
        {
          operation: input.operation,
          usageId: input.usageId,
          repairOrder: input.repairOrder,
        },
        context,
        { ...dependencies, authorization },
      );
    }
    if (action === "record" && input.operation === "aggregateUsageReserve") {
      return (dependencies.reserveMeasuredUsage || reserveMeasuredUsageForWorkorder)(workorderId, input, context, dependencies);
    }
    if (action === "record" && input.operation === "aggregateUsageLifecycle") {
      return (dependencies.releaseMeasuredUsage || releaseOrReverseMeasuredUsageForWorkorder)(workorderId, input, context, dependencies);
    }
    if (["approve", "decline"].includes(action)) {
      const decision = action === "approve" ? "approved" : (input.decision === "needs_info" ? "needs_info" : "rejected");
      return (dependencies.reviewPart || reviewOfficePartRequest)(workorderId, input.requestId, {
        ...input, decision, officeUserId: actorId,
      });
    }
    if (action === "allocate") return (dependencies.allocatePart || changeOfficePartAllocation)(
      workorderId, input.requestId, input.allocationId, { ...input, officeUserId: actorId },
    );
  }

  if (moduleKey === "chat") {
    if (action === "acknowledge") return (dependencies.acknowledge || acknowledgeChatReceipts)({
      workorderId, actorUserId: actorId, ...input,
    });
    if (action === "attach" && !input.attachment) throw invalidRequest("Attach a photo or file.");
    const send = context.actor.role === "mechanic"
      ? (dependencies.sendMechanic || sendMechanicMessage)
      : (dependencies.sendOffice || sendOfficeMessage);
    return send(workorderId, { ...input, senderUserId: actorId, senderRole: context.actor.role });
  }

  if (moduleKey === "completion") {
    if (action === "markWorkDone") {
      if (context.actor.role === "mechanic") {
        return (dependencies.markDone || markMechanicDone)(workorderId, actorId, input);
      }
      if (["office", "admin"].includes(context.actor.role)) {
        return (dependencies.markOfficeDone || markOfficeWorkorderDone)(workorderId, { ...input, officeUserId: actorId });
      }
      throw permissionDenied();
    }
    if (action === "close") return (dependencies.close || closeOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId });
    if (action === "cancel") return (dependencies.cancel || cancelOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId });
    if (action === "requestChanges") return (dependencies.requestChanges || returnOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId });
  }

  if (moduleKey === "odoo") {
    if (action === "prepare") return (dependencies.prepareOdoo || prepareWorkorderOdooModule)(context, workorderId, input);
    if (action === "mapPart") return (dependencies.mapOdooPart || mapWorkorderOdooPart)(context, workorderId, input);
    if (action === "createDraft") return (dependencies.createOdooDraft || createWorkorderOdooDraft)(context, workorderId, input);
    if (action === "markMissingInfo") return (dependencies.markMissingInfo || markWorkorderOdooMissingInfo)(context, workorderId, input);
  }

  throw permissionDenied();
}

export async function readWorkorderModuleRuntime(context, workorderId, moduleKey, dependencies = {}) {
  if (moduleKey === "odoo") return (dependencies.odooReadiness || workorderOdooReadiness)(context, workorderId);
  return protectedWorkorderModule(context, workorderId, moduleKey, dependencies);
}

export async function readWorkorderUnitHistory(context, workorderId, input = {}, dependencies = {}) {
  return (dependencies.readHistory || readUnitServiceHistory)(context, workorderId, input, dependencies);
}

export async function createWorkorderRuntime(context, input, rawInput = input, dependencies = {}) {
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId);
  const authorizeCreate = dependencies.authorizeCreate || authorizeWorkorderCreate;
  await authorizeCreate(context, {
    companyId: input.companyId,
    locationId: input.locationId,
    moduleKeys: workorderInputModules(rawInput, { create: true }),
  });
  const create = dependencies.create || createOperationalWorkorder;
  const loadLaborProduct = dependencies.loadLaborProduct || getConfiguredLaborProduct;
  const laborProduct = await loadLaborProduct(input.companyId);
  const mechanic = context.actor.role === "mechanic";
  try {
    return await create({
      ...input,
      formData: {
        ...(input.formData || {}),
        ...(laborProduct ? { laborProduct } : { laborProduct: null }),
      },
      createdByUserId: context.actor.id,
      mechanicUserIds: mechanic ? [context.actor.id] : input.mechanicUserIds,
      startImmediately: mechanic,
    });
  } catch (error) {
    const mapped = mapActiveAssetConflict(error);
    if (mapped instanceof WorkorderLifecycleConflictError) {
      throw new AuthError(mapped.statusCode, mapped.code, mapped.message);
    }
    throw mapped;
  }
}

export async function workorderCreateContext(context, dependencies = {}) {
  const loadTemplates = dependencies.loadTemplates || getAuthorizedLocationTemplates;
  const resolveModules = dependencies.resolveModules || resolveWorkorderModuleDecisions;
  const listMechanics = dependencies.listMechanics || listUsersByLocation;
  const loadLaborProduct = dependencies.loadLaborProduct || getConfiguredLaborProduct;
  const rows = await loadTemplates({
    companyIds: [...(context.companyIds || [])],
    locationIds: context.actor.role === "admin" ? null : [...(context.locationIds || [])],
  });
  const locations = [];
  const laborProducts = new Map();
  for (const row of rows) {
    const syntheticWorkorderId = `create:${row.location_id}`;
    const { decisions } = await resolveModules(context, syntheticWorkorderId, {
      surface: "create",
      resourceAccess: {},
    }, {
      requireAccess: async () => ({ companyId: row.company_id, locationId: row.location_id }),
    });
    if (decisions.concern?.access === "hidden") continue;
    const canAssign = ["write", "required"].includes(decisions.assignment?.access);
    if (!laborProducts.has(row.company_id)) {
      laborProducts.set(row.company_id, await loadLaborProduct(row.company_id));
    }
    locations.push({
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
      moduleAccess: decisions,
      laborProduct: laborProducts.get(row.company_id),
      mechanics: canAssign
        ? (await listMechanics(row.location_id)).filter((user) => user.role === "mechanic" && user.active)
          .map((user) => ({ id: user.id, name: user.name }))
        : [],
    });
  }
  return { locations };
}

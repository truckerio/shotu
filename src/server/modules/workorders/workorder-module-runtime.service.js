import { AuthError, invalidRequest, permissionDenied } from "../../auth/errors.js";
import { readCreatePricing } from "../../db/repositories/workorder-create-pricing.repo.js";
import { isDeepStrictEqual } from "node:util";
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
import { resolveSubmittedLaborProduct, trustedLocalLaborProduct } from "../labor/labor-products.service.js";
import { assertWorkorderLaborQuantity } from "../../db/repositories/workorder-labor-quantity.js";
import { requireCompanyAccess, requireLocationAccess } from "../../auth/authorize.js";
import { companyRoleScope, effectiveCompanyContext } from "../../auth/company-role.js";
import { PERMISSION } from "../../auth/permissions.js";
import { requireWorkorderAccess } from "../../auth/resource-access.js";
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
import { selectWorkorderPartPrice } from "./workorder-part-pricing.service.js";
import { listWorkorderNoStockPartPrices } from "../../db/repositories/workorder-part-pricing.repo.js";
import {
  reviseWorkorderLaborRate,
  selectWorkorderLaborPrice,
  workorderPricingSummary,
} from "./workorder-labor-pricing.service.js";
import { readWorkorderLaborPricing } from "../../db/repositories/workorder-labor-pricing.repo.js";
import {
  applyManualPartEvidence,
  listWorkorderManualPartEvidence,
} from "../../db/repositories/workorder-manual-part-evidence.repo.js";
import { createPartRequest as createCanonicalPartRequest } from "../../db/repositories/part-requests.repo.js";
import { listWorkorderInstalledSerializedPartSummaries } from "../../db/repositories/inventory-unit-workorder-usage.repo.js";

function resourceOptions(context) {
  return [...(context.companyIds || [])].some((companyId) => context.companyRoles?.get(companyId) === "mechanic")
    || (!(context.companyRoles instanceof Map) && context.companyIds?.size === 1 && context.actor.role === "mechanic")
    ? { allowAvailable: true, allowActiveAtLocation: true }
    : {};
}

function canReadCustomerFinancials(context) {
  return ["office", "admin"].includes(context.actor.role)
    && context.permissions?.has(PERMISSION.CUSTOMER_DOCUMENT_READ) === true;
}

function canWriteCustomerFinancials(context) {
  return ["office", "admin"].includes(context.actor.role)
    && context.permissions?.has(PERMISSION.CUSTOMER_DOCUMENT_WRITE) === true;
}

async function withInstalledSerializedParts(detail, decisions, dependencies) {
  if (!decisions?.parts || decisions.parts.access === "hidden") return detail;
  const listInstalledParts = dependencies.listInstalledParts || listWorkorderInstalledSerializedPartSummaries;
  const listMeasuredParts = dependencies.listAggregateUsages || listAggregateWorkorderUsages;
  const listManualEvidence = dependencies.listManualPartEvidence || listWorkorderManualPartEvidence;
  const formData = detail.workorder.formData || {};
  const hasManualEvidence = Array.isArray(formData.parts)
    && formData.parts.some((part) => part?.evidenceId);
  const hasNoStockParts = Array.isArray(formData.parts)
    && formData.parts.some((part) => part?.noStockLineId);
  const listNoStockPrices = dependencies.listNoStockPartPrices || listWorkorderNoStockPartPrices;
  const [installedRows, aggregateRows, manualPartEvidence, noStockPartPrices] = await Promise.all([
    listInstalledParts({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      limit: 2001,
    }),
    listMeasuredParts({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      limit: 201,
    }),
    hasManualEvidence ? listManualEvidence({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      limit: 100,
    }) : [],
    hasNoStockParts ? listNoStockPrices({
      workorderId: detail.workorder.id,
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
    }) : [],
  ]);
  const pricingRowsTruncated = installedRows.length > 2000 || aggregateRows.length > 200;
  const installedSerializedParts = installedRows.slice(0, 2000);
  const aggregatePartUsages = aggregateRows.slice(0, 200);
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
    noStockPartPrices,
    pricingRowsTruncated,
  };
}

export async function projectLoadedProtectedWorkorderDetail(
  detail,
  decisions,
  options = {},
  dependencies = {},
) {
  const enriched = await withInstalledSerializedParts(detail, decisions, dependencies);
  if (["office", "admin"].includes(options.viewerRole)
    && decisions?.diagnosisRepair
    && decisions.diagnosisRepair.access !== "hidden") {
    const readLaborPricing = dependencies.readLaborPricing || readWorkorderLaborPricing;
    const labor = (detail.workorder.formData?.laborProduct?.productId
      || Number(detail.workorder.formData?.laborHours) > 0) ? await readLaborPricing({
      companyId: detail.workorder.companyId,
      locationId: detail.workorder.locationId,
      workorderId: detail.workorder.id,
      productId: detail.workorder.formData?.laborProduct?.productId || null,
    }) : { laborPrice: null, currentLaborRates: {} };
    enriched.laborPrice = labor.laborPrice
      && labor.laborPrice.productId === detail.workorder.formData?.laborProduct?.productId
      && Number(labor.laborPrice.hours) === Number(detail.workorder.formData?.laborHours)
      && (labor.laborPrice.uomCode || "hr") === (detail.workorder.formData?.laborProduct?.uomCode || "hr")
      ? labor.laborPrice : null;
    enriched.currentLaborRates = labor.currentLaborRates;
    if (decisions?.parts && decisions.parts.access !== "hidden") {
      enriched.workorderPricing = workorderPricingSummary({ ...enriched, laborPrice: enriched.laborPrice });
    }
  }
  return projectProtectedWorkorderDetail(enriched, decisions, options);
}

export async function protectedWorkorderDetail(context, workorderId, dependencies = {}) {
  const resolveModules = dependencies.resolveModules || resolveWorkorderModuleDecisions;
  const loadDetail = dependencies.loadDetail || loadWorkorderDetail;
  const { decisions, workorder } = await resolveModules(context, workorderId, {
    resourceAccess: resourceOptions(context),
  });
  context = effectiveCompanyContext(context, workorder.companyId);
  const loadedDetail = await loadDetail(workorderId, {
    viewerUserId: context.actor.id,
    participantChatOnly: context.actor.role === "mechanic",
  });
  return projectLoadedProtectedWorkorderDetail(
    loadedDetail,
    decisions,
    {
      viewerRole: context.actor.role,
      canReadCustomerFinancials: canReadCustomerFinancials(context),
      canWriteCustomerFinancials: canWriteCustomerFinancials(context),
    },
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
  context = effectiveCompanyContext(context, authorization.workorder.companyId);
  const loadedDetail = await loadDetail(workorderId, {
    viewerUserId: context.actor.id,
    participantChatOnly: context.actor.role === "mechanic",
  });
  const decisions = { [moduleKey]: { access: authorization.access, source: authorization.source } };
  return projectLoadedProtectedWorkorderDetail(
    loadedDetail,
    decisions,
    {
      viewerRole: context.actor.role,
      canReadCustomerFinancials: canReadCustomerFinancials(context),
      canWriteCustomerFinancials: canWriteCustomerFinancials(context),
    },
    dependencies,
  );
}

function hasLaborProductPatch(input) {
  return Object.prototype.hasOwnProperty.call(input?.formData || {}, "laborProduct");
}

function hasLaborHoursPatch(input) {
  return Object.prototype.hasOwnProperty.call(input || {}, "laborHours")
    || Object.prototype.hasOwnProperty.call(input?.formData || {}, "laborHours");
}

const CUSTOMER_DOCUMENT_FORM_FIELDS = Object.freeze([
  "customerDocumentAdjustments",
  "customerDocumentAdjustmentBaseRevisionId",
]);

function preserveUntouchedCustomerDocumentForm(input, workorder) {
  if (!Object.prototype.hasOwnProperty.call(input || {}, "formData")) return input;
  const savedForm = workorder?.formData || {};
  const formData = { ...(input.formData || {}) };
  for (const key of CUSTOMER_DOCUMENT_FORM_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(formData, key)
      && Object.prototype.hasOwnProperty.call(savedForm, key)) {
      formData[key] = savedForm[key];
    }
  }
  return { ...input, formData };
}

function laborProductPatchChanged(input, workorder) {
  if (!hasLaborProductPatch(input)) return false;
  const requested = input.formData.laborProduct;
  const saved = workorder?.formData?.laborProduct;
  if (requested === null && saved == null) return false;
  return !isDeepStrictEqual(requested, saved);
}

async function canonicalizeLaborProductPatch(context, input, workorder, dependencies) {
  if (!laborProductPatchChanged(input, workorder)) return input;
  if (!["office", "admin"].includes(context.actor.role)) throw permissionDenied();
  const requested = input.formData.laborProduct;
  if (requested === null) return input;
  if (!requested?.productId) {
    throw invalidRequest("Select a valid local labor product.");
  }
  const resolveLaborProduct = dependencies.resolveLaborProduct || trustedLocalLaborProduct;
  const laborProduct = await resolveLaborProduct({
    productId: requested.productId,
    companyId: workorder.companyId,
    locationId: workorder.locationId || null,
  }, context);
  return {
    ...input,
    formData: {
      ...input.formData,
      laborProduct,
    },
  };
}

export async function patchWorkorderModule(context, workorderId, moduleKey, input, dependencies = {}) {
  const authorize = dependencies.authorize || authorizeWorkorderModule;
  const authorization = await authorize(context, workorderId, { moduleKey, capability: "write", action: "update" });
  context = effectiveCompanyContext(context, authorization.workorder.companyId);
  if (["unit", "location", "schedule", "assignment", "concern"].includes(moduleKey)) {
    const update = dependencies.updateOffice || updateOfficeWorkorder;
    const preservedInput = preserveUntouchedCustomerDocumentForm(input, authorization?.workorder);
    return update(workorderId, { ...preservedInput, officeUserId: context.actor.id, authContext: context });
  }
  if (moduleKey === "diagnosisRepair") {
    if (hasLaborProductPatch(input) && !["office", "admin"].includes(context.actor.role)) {
      throw permissionDenied();
    }
    const normalizedInput = await canonicalizeLaborProductPatch(
      context, input, authorization?.workorder, dependencies,
    );
    if (["office", "admin"].includes(context.actor.role)) {
      const update = dependencies.updateOffice || updateOfficeWorkorder;
      const preservedInput = preserveUntouchedCustomerDocumentForm(normalizedInput, authorization?.workorder);
      return update(workorderId, { ...preservedInput, officeUserId: context.actor.id, authContext: context });
    }
    const update = dependencies.updateMechanic || saveMechanicWorkorderProgress;
    return update(workorderId, context.actor.id, normalizedInput, context);
  }
  throw permissionDenied();
}

export async function patchWorkorderModules(context, workorderId, moduleKeys, input, dependencies = {}) {
  if (!moduleKeys.length) throw invalidRequest("No writable module fields were provided.");
  const loadWorkorder = dependencies.loadWorkorder || requireWorkorderAccess;
  const submittedLaborProduct = hasLaborProductPatch(input);
  const submittedLaborHours = hasLaborHoursPatch(input);
  const loadedWorkorder = submittedLaborProduct
    ? await loadWorkorder(context, workorderId)
    : null;
  const laborProductChanged = submittedLaborProduct
    && laborProductPatchChanged(input, loadedWorkorder);
  const effectiveModuleKeys = laborProductChanged
    ? [...new Set([...moduleKeys, "diagnosisRepair"])]
    : moduleKeys.filter((moduleKey) => moduleKey !== "diagnosisRepair" || submittedLaborHours);
  if (!effectiveModuleKeys.length) return loadedWorkorder;
  const authorizeMany = dependencies.authorizeMany || authorizeWorkorderModuleActions;
  const authorization = await authorizeMany(context, workorderId, effectiveModuleKeys.map((moduleKey) => ({
    moduleKey,
    capability: "write",
    action: "update",
  })));
  context = effectiveCompanyContext(context, authorization.workorder.companyId);
  const normalizedInput = laborProductChanged
    ? await canonicalizeLaborProductPatch(
      context, input, authorization?.workorder || loadedWorkorder, dependencies,
    )
    : input;
  const preservedInput = preserveUntouchedCustomerDocumentForm(
    normalizedInput,
    authorization?.workorder || loadedWorkorder,
  );
  const update = dependencies.updateOffice || updateOfficeWorkorder;
  return update(workorderId, { ...preservedInput, officeUserId: context.actor.id, authContext: context });
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
  const isPartRequest = moduleKey === "parts" && action === "request";
  const requestWorkorder = isPartRequest
    ? await (dependencies.loadWorkorder || requireWorkorderAccess)(context, workorderId, resourceOptions(context))
    : null;
  if (requestWorkorder) context = effectiveCompanyContext(context, requestWorkorder.companyId);
  const authorization = await authorize(context, workorderId, {
    moduleKey,
    capability: isPartRequest && context.actor.role === "mechanic" ? "read" : "write",
    action,
    resourceAccess: requestWorkorder
      ? { getWorkorder: async () => requestWorkorder }
      : action === "accept" ? resourceOptions(context) : {},
  });
  context = effectiveCompanyContext(context, authorization.workorder.companyId);
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

  if (moduleKey === "diagnosisRepair" && action === "record") {
    if (input.operation === "laborRateRevision") {
      return (dependencies.reviseLaborRate || reviseWorkorderLaborRate)(
        workorderId, input, context, authorization, dependencies,
      );
    }
    if (input.operation === "laborPriceSelection") {
      return (dependencies.selectLaborPrice || selectWorkorderLaborPrice)(
        workorderId, input, context, { ...dependencies, authorizedWorkorder: authorization.workorder },
      );
    }
  }

  if (moduleKey === "assignment") {
    if (action === "accept") {
      if (context.actor.role !== "mechanic") throw permissionDenied();
      return (dependencies.accept || acceptMechanicWorkorder)(workorderId, actorId, context);
    }
    if (action === "release") return (dependencies.release || releaseMechanicWorkorder)(workorderId, actorId, input.reason, context);
    if (action === "assign") return (dependencies.assign || assignOfficeWorkorderMechanics)(workorderId, { ...input, officeUserId: actorId, authContext: context });
    if (action === "reassign") return (dependencies.reassign || reassignOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId, authContext: context });
  }

  if (moduleKey === "parts") {
    if (action === "request") {
      if (dependencies.requestPart) return dependencies.requestPart(workorderId,{...input,mechanicUserId:actorId,actorRole:context.actor.role,authContext:context});
      return context.actor.role === "mechanic"
        ? requestMechanicPart(workorderId,{...input,mechanicUserId:actorId,actorRole:context.actor.role,authContext:context})
        : createCanonicalPartRequest(workorderId,{...input,mechanicUserId:actorId,actorRole:context.actor.role});
    }
    if (action === "record" && input.operation === "usedParts") {
      return context.actor.role === "mechanic"
        ? (dependencies.saveMechanicParts || saveMechanicUsedParts)(workorderId, actorId, input.parts, input.laborHours, context)
        : (dependencies.saveOfficeParts || saveOfficeUsedParts)(workorderId, {
          parts: input.parts,
          laborHours: input.laborHours,
          officeUserId: actorId,
          authContext: context,
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
        authContext: context,
      });
    }
    if (action === "record" && input.operation === "usage" && context.actor.role === "mechanic") {
      return (dependencies.updateUsage || updateMechanicPartUsage)(workorderId, input.requestId, { ...input, mechanicUserId: actorId, authContext: context });
    }
    if (action === "record" && input.operation === "officePart" && ["office", "admin"].includes(context.actor.role)) {
      return (dependencies.addOfficePart || addOfficePart)(workorderId, { ...input, officeUserId: actorId, authContext: context });
    }
    if (action === "record" && input.operation === "officePartPlan" && ["office", "admin"].includes(context.actor.role)) {
      return (dependencies.planOfficePart || planOfficePart)(workorderId, { ...input, officeUserId: actorId, authContext: context });
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
    if (action === "record" && input.operation === "partPriceSelection") {
      return (dependencies.selectPartPrice || selectWorkorderPartPrice)(
        workorderId, input, context, { ...dependencies, authorizedWorkorder: authorization.workorder },
      );
    }
    if (["approve", "decline"].includes(action)) {
      const decision = action === "approve" ? "approved" : (input.decision === "needs_info" ? "needs_info" : "rejected");
      return (dependencies.reviewPart || reviewOfficePartRequest)(workorderId, input.requestId, {
        ...input, decision, officeUserId: actorId, authContext: context,
      });
    }
    if (action === "allocate") return (dependencies.allocatePart || changeOfficePartAllocation)(
      workorderId, input.requestId, input.allocationId, { ...input, officeUserId: actorId, authContext: context },
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
    return send(workorderId, { ...input, senderUserId: actorId, senderRole: context.actor.role, authContext: context });
  }

  if (moduleKey === "completion") {
    if (action === "markWorkDone") {
      if (context.actor.role === "mechanic") {
        return (dependencies.markDone || markMechanicDone)(workorderId, actorId, input, context);
      }
      if (["office", "admin"].includes(context.actor.role)) {
        return (dependencies.markOfficeDone || markOfficeWorkorderDone)(workorderId, { ...input, officeUserId: actorId, authContext: context });
      }
      throw permissionDenied();
    }
    if (action === "close") return (dependencies.close || closeOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId, authContext: context });
    if (action === "cancel") return (dependencies.cancel || cancelOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId, authContext: context });
    if (action === "requestChanges") return (dependencies.requestChanges || returnOfficeWorkorder)(workorderId, { ...input, officeUserId: actorId, authContext: context });
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
  context = effectiveCompanyContext(context, input.companyId);
  const mechanic = context.actor.role === "mechanic";
  const customerIdentity = String(input.formData?.customerCompanyName || rawInput?.formData?.customerCompanyName || "").trim();
  if (mechanic && customerIdentity) {
    throw new AuthError(409, "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED", "Customer Workorders must be issued and accepted through the Office Estimate workflow.");
  }
  if (mechanic) {
    input = {
      ...input,
      authorizationClassification: "internal_fleet",
      authorizationExceptionReason: "Server-owned mechanic self-create workflow",
    };
  }
  if (input.pricing && !["office", "admin"].includes(context.actor.role)) throw permissionDenied();
  if (input.pricing && !input.pricing.expectedFingerprint) {
    throw new AuthError(409, "WORKORDER_PRICING_PREVIEW_REQUIRED", "Refresh the pricing preview before creating this workorder.");
  }
  if (!input.authorizationClassification) {
    throw new AuthError(409, "WORKORDER_AUTHORIZATION_CLASSIFICATION_REQUIRED", "Choose the Workorder authorization path before creating it.");
  }
  if (input.authorizationClassification === "required_external_customer") {
    throw new AuthError(409, "CUSTOMER_ESTIMATE_ACCEPTANCE_REQUIRED", "Create this customer Workorder from its accepted Estimate.");
  }
  if (input.authorizationClassification === "approval_not_required") {
    throw new AuthError(409, "CUSTOMER_ESTIMATE_ISSUE_REQUIRED", "Create this Workorder from its Office draft so its informational Estimate is issued and linked.");
  }
  if (["internal_fleet", "exempt"].includes(input.authorizationClassification)
    && context.actor.role !== "admin" && !mechanic) throw permissionDenied();
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId);
  const authorizeCreate = dependencies.authorizeCreate || authorizeWorkorderCreate;
  await authorizeCreate(context, {
    companyId: input.companyId,
    locationId: input.locationId,
    moduleKeys: workorderInputModules(rawInput, { create: true }),
  });
  const create = dependencies.create || createOperationalWorkorder;
  const laborProduct = await resolveSubmittedLaborProduct({
    companyId: input.companyId,
    locationId: input.locationId,
    selection: input.formData?.laborProduct,
  }, context, {
    resolveLocal: dependencies.resolveLaborProduct,
    resolveLegacy: dependencies.resolveLegacyLaborProduct,
    loadDefault: dependencies.loadLaborProduct,
  });
  assertWorkorderLaborQuantity({ ...input.formData, laborProduct });
  try {
    return await create({
      ...input,
      formData: {
        ...(input.formData || {}),
        ...(laborProduct ? { laborProduct } : { laborProduct: null }),
      },
      createdByUserId: context.actor.id,
      createdByRole: context.actor.role,
      mechanicUserIds: mechanic ? [context.actor.id] : input.mechanicUserIds,
      startImmediately: mechanic,
      activationPolicy: "legacy_internal_fleet_direct_v1",
      authorizationAuthority: mechanic ? "mechanic_self_create" : context.actor.role,
    });
  } catch (error) {
    const mapped = mapActiveAssetConflict(error);
    if (mapped instanceof WorkorderLifecycleConflictError) {
      throw new AuthError(mapped.statusCode, mapped.code, mapped.message);
    }
    throw mapped;
  }
}

export async function previewCreateWorkorderPricing(context, input, dependencies = {}) {
  context = effectiveCompanyContext(context, input.companyId);
  if (!["office", "admin"].includes(context.actor.role)) throw permissionDenied();
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId);
  if (!input.locationId) throw invalidRequest("Choose a location first.");
  await (dependencies.authorizeCreate || authorizeWorkorderCreate)(context, {
    companyId: input.companyId, locationId: input.locationId,
    moduleKeys: workorderInputModules(input, { create: true }),
  });
  const laborProduct = await resolveSubmittedLaborProduct({
    companyId: input.companyId, locationId: input.locationId,
    selection: input.formData?.laborProduct,
  }, context, {
    resolveLocal: dependencies.resolveLaborProduct,
    resolveLegacy: dependencies.resolveLegacyLaborProduct,
    loadDefault: dependencies.loadLaborProduct,
  });
  input = { ...input, formData: { ...input.formData, laborProduct } };
  if (input.formData?.laborHours) assertWorkorderLaborQuantity(input.formData);
  return (dependencies.readPricing || readCreatePricing)(input);
}

export async function workorderCreateContext(context, dependencies = {}) {
  const loadTemplates = dependencies.loadTemplates || getAuthorizedLocationTemplates;
  const resolveModules = dependencies.resolveModules || resolveWorkorderModuleDecisions;
  const listMechanics = dependencies.listMechanics || listUsersByLocation;
  const loadLaborProduct = dependencies.loadLaborProduct || getConfiguredLaborProduct;
  const adminCompanyIds = companyRoleScope(context, ["admin"]).companyIds;
  const assignedCompanyIds = companyRoleScope(context, ["office", "mechanic"]).companyIds;
  const groups = await Promise.all([
    adminCompanyIds.length ? loadTemplates({ companyIds: adminCompanyIds, locationIds: null }) : [],
    assignedCompanyIds.length ? loadTemplates({ companyIds: assignedCompanyIds, locationIds: [...(context.locationIds || [])] }) : [],
  ]);
  const rows = groups.flat();
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

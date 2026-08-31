import { WORKORDER_ACCESS_MODES } from "../../../../shared/workorder-modules.js";

const FORM_KEYS = Object.freeze({
  unit: Object.freeze(["customerCompanyName", "companyName", "unitNo", "unitType", "licenseNo", "mileage", "model", "vinNo"]),
  schedule: Object.freeze(["workStartDate", "workEndDate", "startTime", "endTime"]),
  assignment: Object.freeze(["mechanicName", "customerSignature", "authorizedBy"]),
  concern: Object.freeze(["mechanicConcern"]),
  diagnosisRepair: Object.freeze(["laborHours", "laborProduct"]),
  parts: Object.freeze(["parts"]),
});

const BASE_WORKORDER_KEYS = Object.freeze([
  "id", "companyId", "serial", "status", "progressVersion", "createdAt", "updatedAt",
]);

const MECHANIC_PART_REQUEST_KEYS = Object.freeze([
  "id", "workorderId", "catalogPartId", "requestedByName", "rawQuery", "partNumber",
  "manufacturer", "description", "category", "quantity", "uomCode", "repairOrder",
  "approvalStatus", "fitmentStatus", "fitmentNotes", "usageStatus", "approvedByName",
  "approvedAt", "decisionReason", "createdAt", "updatedAt",
]);

const MECHANIC_AVAILABILITY_KEYS = Object.freeze([
  "locationId", "locationName", "quantityAvailable", "uomCode", "updatedAt",
]);

const ALLOWED_ACTION_MODULES = Object.freeze({
  accept: "assignment", release: "assignment", assignMechanics: "assignment",
  saveNotes: "diagnosisRepair", sendMessage: "chat",
  recordUsedParts: "parts", requestParts: "parts", addApprovedParts: "parts", planParts: "parts",
  markDone: "completion", approve: "completion", returnToMechanic: "completion", cancel: "completion",
  updateAdministrative: "concern",
});

const ATTENTION_MODULES = Object.freeze({
  parts: "parts",
  office_help: "chat",
  missing_info: "odoo",
  revision_requested: "completion",
  overdue: "schedule",
});

function canWrite(decisions, moduleKey) {
  return [WORKORDER_ACCESS_MODES.WRITE, WORKORDER_ACCESS_MODES.REQUIRED]
    .includes(decisions?.[moduleKey]?.access);
}

function canRead(decisions, moduleKey) {
  return decisions?.[moduleKey]?.access !== undefined
    && decisions[moduleKey].access !== WORKORDER_ACCESS_MODES.HIDDEN;
}

function filterAllowedActions(actions, decisions) {
  const output = {};
  for (const [action, enabled] of Object.entries(actions || {})) {
    if (action === "update") {
      output[action] = Boolean(enabled) && ["unit", "location", "schedule", "assignment", "concern"]
        .some((moduleKey) => canWrite(decisions, moduleKey));
      continue;
    }
    const moduleKey = ALLOWED_ACTION_MODULES[action];
    output[action] = Boolean(enabled) && Boolean(moduleKey)
      && (action === "requestParts" ? canRead(decisions, moduleKey) : canWrite(decisions, moduleKey));
  }
  return output;
}

function filterAttention(attention, decisions) {
  return (attention || []).filter((entry) => {
    const reason = typeof entry === "string" ? entry : entry?.reason;
    const moduleKey = ATTENTION_MODULES[reason];
    return moduleKey && decisions?.[moduleKey]?.access !== WORKORDER_ACCESS_MODES.HIDDEN;
  });
}

function pick(source, keys) {
  return Object.fromEntries(keys
    .filter((key) => Object.prototype.hasOwnProperty.call(source || {}, key))
    .map((key) => [key, source[key]]));
}

function formSlice(workorder, moduleKey) {
  return pick(workorder?.formData || {}, FORM_KEYS[moduleKey] || []);
}

function mechanicPartRequest(request, workorderLocationId) {
  return {
    ...pick(request, MECHANIC_PART_REQUEST_KEYS),
    allocations: [],
    inventory: (request?.inventory || [])
      .filter((item) => workorderLocationId && item.locationId === workorderLocationId)
      .map((item) => pick(item, MECHANIC_AVAILABILITY_KEYS)),
  };
}

function moduleData(detail, moduleKey, { viewerRole = null } = {}) {
  const { workorder = {} } = detail;
  switch (moduleKey) {
    case "unit": return { ...pick(workorder, ["assetId", "asset"]), formData: formSlice(workorder, moduleKey) };
    case "location": return pick(workorder, ["locationId", "location"]);
    case "schedule": return { ...pick(workorder, ["acceptedAt", "startedAt", "mechanicDoneAt", "closedAt", "cancelledAt"]), formData: formSlice(workorder, moduleKey) };
    case "assignment": return {
      ...pick(workorder, ["createdByUserId", "currentMechanicId", "mechanic", "mechanics", "mechanicIds"]),
      formData: formSlice(workorder, moduleKey),
      participants: detail.participants || [],
      assignableMechanics: detail.assignableMechanics || [],
    };
    case "concern": return { ...pick(workorder, ["concern", "officeNotes"]), formData: formSlice(workorder, moduleKey) };
    case "diagnosisRepair": return {
      ...pick(workorder, ["diagnosis", "workPerformed"]),
      formData: formSlice(workorder, moduleKey),
    };
    case "photos": return {
      attachments: (detail.messages || []).filter((message) => message.attachment).map((message) => ({
        id: message.id,
        createdAt: message.createdAt,
        attachment: message.attachment,
      })),
    };
    case "parts": return {
      formData: formSlice(workorder, moduleKey),
      installedSerializedParts: detail.installedSerializedParts || [],
      aggregatePartUsages: detail.aggregatePartUsages || [],
      partRequests: ["mechanic", "kiosk"].includes(viewerRole)
        ? (detail.partRequests || []).map((request) => mechanicPartRequest(
          request,
          workorder.locationId || workorder.location?.id || null,
        ))
        : detail.partRequests || [],
    };
    case "chat": return { messages: detail.messages || [] };
    case "activity": return { timeline: detail.timeline || [] };
    case "preview": return { available: true };
    case "completion": return pick(workorder, [
      "mechanicDoneAt", "closedAt", "approvedByUserId", "approvedByName", "approvedBy",
      "cancelledAt", "cancelledByUserId", "cancelledByName", "cancelReason",
    ]);
    case "odoo": return pick(workorder, ["odooStatus", "odooServiceOrderNo", "odooExternalId", "odooUrl"]);
    default: return {};
  }
}

function mergeCompatibility(output, moduleKey, data) {
  if (data.formData) output.workorder.formData = { ...output.workorder.formData, ...data.formData };
  for (const [key, value] of Object.entries(data)) {
    if (key === "formData" || ["messages", "timeline", "partRequests", "participants", "assignableMechanics", "attachments", "available"].includes(key)) continue;
    output.workorder[key] = value;
  }
  for (const key of ["messages", "timeline", "partRequests", "participants", "assignableMechanics"]) {
    if (Object.prototype.hasOwnProperty.call(data, key)) output[key] = data[key];
  }
  if (moduleKey === "photos") output.attachments = data.attachments;
}

export function projectProtectedWorkorderDetail(detail, moduleDecisions, options = {}) {
  const viewerRole = options.viewerRole || detail.user?.role || null;
  const output = {
    workorder: { ...pick(detail.workorder || {}, BASE_WORKORDER_KEYS), formData: {} },
    moduleAccess: {},
    modules: {},
  };
  for (const [moduleKey, decision] of Object.entries(moduleDecisions || {})) {
    const access = decision?.access || WORKORDER_ACCESS_MODES.HIDDEN;
    output.moduleAccess[moduleKey] = { access, source: decision?.source || "default" };
    if (access === WORKORDER_ACCESS_MODES.HIDDEN) continue;
    const data = moduleData(detail, moduleKey, { viewerRole });
    output.modules[moduleKey] = { access, data };
    mergeCompatibility(output, moduleKey, data);
  }
  if (Object.prototype.hasOwnProperty.call(detail, "user")) output.user = detail.user;
  if (Object.prototype.hasOwnProperty.call(detail, "allowedActions")) {
    output.allowedActions = filterAllowedActions(detail.allowedActions, moduleDecisions);
  }
  if (Object.prototype.hasOwnProperty.call(detail, "activeAttention")) {
    output.activeAttention = filterAttention(detail.activeAttention, moduleDecisions);
  }
  if (detail.policy) output.policy = {
    mechanicCanRecordParts: detail.policy.mechanicCanRecordParts === true,
  };
  return output;
}

export function workorderInputModules(input, { create = false } = {}) {
  const modules = new Set(create ? ["concern"] : []);
  if (Object.prototype.hasOwnProperty.call(input || {}, "assetId")) modules.add("unit");
  if (Object.prototype.hasOwnProperty.call(input || {}, "locationId")) modules.add("location");
  if (Object.prototype.hasOwnProperty.call(input || {}, "concern") || Object.prototype.hasOwnProperty.call(input || {}, "officeNotes")) modules.add("concern");
  if (Object.prototype.hasOwnProperty.call(input || {}, "diagnosis")
    || Object.prototype.hasOwnProperty.call(input || {}, "workPerformed")) modules.add("diagnosisRepair");
  if (Object.prototype.hasOwnProperty.call(input || {}, "mechanicUserIds")) modules.add("assignment");
  const formData = input?.formData;
  if (formData && typeof formData === "object") {
    for (const [moduleKey, keys] of Object.entries(FORM_KEYS)) {
      if (keys.some((key) => Object.prototype.hasOwnProperty.call(formData, key))) modules.add(moduleKey);
    }
    const known = new Set(Object.values(FORM_KEYS).flat());
    if (Object.keys(formData).some((key) => !known.has(key))) modules.add("concern");
  }
  return [...modules];
}

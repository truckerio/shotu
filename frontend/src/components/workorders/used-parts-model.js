import { DEFAULT_UOM_CODE, normalizeUomCode } from "../../../../shared/units-of-measure.js";
import { DEFAULT_PART_ENTRY_ROWS } from "../../../../shared/workorder-template.js";

export const MAX_USED_PARTS = 18;

export function canEditUsedParts(role, allowedActions = {}) {
  if (allowedActions.recordUsedParts === true) return true;
  return role === "office" && allowedActions.recordUsedParts !== false;
}

export function usedPartsAccessState(role, allowedActions = {}) {
  return canEditUsedParts(role, allowedActions)
    ? { editable: true, message: "" }
    : { editable: false, message: "Actual parts are read-only. Office or a user with Parts edit access can add them." };
}

export function emptyUsedPart() {
  return { partNo: "", qty: "", uomCode: DEFAULT_UOM_CODE, repairOrder: "" };
}

export function defaultUsedPartQuantity(quantity) {
  const value = quantity === null || quantity === undefined ? "" : String(quantity).trim();
  return value || "1";
}

export function usedPartQuantityAfterPartNumberChange(part, partNumber) {
  const quantity = part?.qty === null || part?.qty === undefined ? "" : String(part.qty).trim();
  if (String(partNumber || "").trim()) return defaultUsedPartQuantity(quantity);
  return quantity === "1" && !String(part?.repairOrder || "").trim() ? "" : quantity;
}

export function usedPartHasValue(part) {
  return Boolean(part?.partNo || part?.qty || part?.repairOrder || part?.requestId);
}

export function normalizeUsedParts(parts, minimumRows = 0) {
  const rows = Array.isArray(parts) ? parts.map((part) => ({
    partNo: String(part?.partNo || ""),
    qty: part?.qty === null || part?.qty === undefined ? "" : String(part.qty),
    uomCode: normalizeUomCode(part?.uomCode),
    repairOrder: String(part?.repairOrder || ""),
    ...(part?.requestId ? { requestId: part.requestId } : {}),
    ...(part?.evidenceId ? { evidenceId: String(part.evidenceId) } : {}),
  })) : [];
  const minimum = Math.max(0, Math.min(MAX_USED_PARTS, Number(minimumRows) || 0));
  while (rows.length > minimum && !usedPartHasValue(rows.at(-1))) rows.pop();
  while (rows.length < minimum) rows.push(emptyUsedPart());
  return rows.slice(0, MAX_USED_PARTS);
}

export function initialUsedPartRows(parts, defaultRows = DEFAULT_PART_ENTRY_ROWS) {
  return normalizeUsedParts(parts, defaultRows);
}

export function addUsedPart(parts, minimumRows = 0) {
  const rows = normalizeUsedParts(parts, minimumRows);
  return rows.length >= MAX_USED_PARTS ? rows : [...rows, emptyUsedPart()];
}

export function removeUsedPart(parts, index, minimumRows = 0) {
  const rows = normalizeUsedParts(parts, Array.isArray(parts) ? parts.length : 0);
  const next = rows.filter((_, rowIndex) => rowIndex !== index);
  return normalizeUsedParts(next, minimumRows);
}

export function readonlyUsedParts(parts) {
  return normalizeUsedParts(parts).filter(usedPartHasValue);
}

export function installedSerializedUsedParts(detail) {
  const summaries = detail?.modules?.parts?.data?.installedSerializedParts;
  if (!Array.isArray(summaries)) return [];
  return summaries.flatMap((part) => {
    const partNo = String(part?.partNumber || "").trim();
    const quantity = Number(part?.quantity);
    if (!partNo || !Number.isInteger(quantity) || quantity < 1) return [];
    const usageId = String(part?.usageId || part?.id || "").trim();
    const serialNumber = String(part?.serialNumber || "").trim();
    const description = String(part?.description || part?.catalogDescription || "").trim();
    const repairOrder = Object.hasOwn(part || {}, "repairOrder")
      ? String(part.repairOrder || "").trim()
      : description;
    const status = String(part?.status || "").trim();
    return [{
      ...(usageId ? { usageId } : {}),
      partNo,
      qty: String(quantity),
      uomCode: normalizeUomCode(part?.uomCode),
      ...(serialNumber ? { serialNumber } : {}),
      ...(description ? { description } : {}),
      repairOrder,
      ...(status ? { status } : {}),
      ...(status === "installed_pending_approval" ? { pendingApproval: true } : {}),
      catalogPartId: part?.catalogPartId || null,
    }];
  });
}

export function serializedUsageTableState(usages, actionsFor) {
  if (!Array.isArray(usages) || typeof actionsFor !== "function") {
    return { active: [], completed: [] };
  }
  const active = [];
  const completed = [];
  for (const usage of usages) {
    const actions = actionsFor(usage) || {};
    if (!actions.install && !actions.returnUnused && !actions.remove) {
      completed.push(usage);
      continue;
    }
    active.push({
      usage,
      usageId: usage.id,
      catalogPartId: usage.catalogPartId,
      partNo: usage.partNumber,
      qty: "1",
      uomCode: usage.uomCode,
      serialNumber: usage.serialNumber,
      description: usage.description || "",
      repairOrder: usage.repairOrder || "",
      status: usage.status,
    });
  }
  return { active, completed };
}

export function workorderPreviewParts(manualParts, installedParts, aggregateParts = []) {
  const aggregateEvidence = new Set((Array.isArray(aggregateParts) ? aggregateParts : [])
    .map((part) => part?.evidenceId)
    .filter(Boolean));
  return [
    ...(Array.isArray(installedParts) ? installedParts : []),
    ...normalizeUsedParts(manualParts).filter((part) => usedPartHasValue(part) && !aggregateEvidence.has(part.evidenceId)),
    ...(Array.isArray(aggregateParts) ? aggregateParts : []),
  ].map(({
    catalogPartId: _catalogPartId,
    usageId: _usageId,
    description: _description,
    evidenceId: _evidenceId,
    status: _status,
    pendingApproval,
    ...part
  }) => ({ ...part, ...(pendingApproval ? { pendingApproval: true } : {}) }));
}

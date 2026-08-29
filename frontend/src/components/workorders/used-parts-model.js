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
    : { editable: false, message: "Used parts are read-only for your role." };
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
    return [{
      partNo,
      qty: String(quantity),
      uomCode: normalizeUomCode(part?.uomCode),
      repairOrder: "Installed",
      catalogPartId: part?.catalogPartId || null,
    }];
  });
}

export function workorderPreviewParts(manualParts, installedParts) {
  return [
    ...(Array.isArray(installedParts) ? installedParts : []),
    ...normalizeUsedParts(manualParts).filter(usedPartHasValue),
  ].map(({ catalogPartId: _catalogPartId, ...part }) => part);
}

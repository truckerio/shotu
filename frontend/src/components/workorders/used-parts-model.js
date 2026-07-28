export const MAX_USED_PARTS = 18;

export function emptyUsedPart() {
  return { partNo: "", qty: "", repairOrder: "" };
}

export function usedPartHasValue(part) {
  return Boolean(part?.partNo || part?.qty || part?.repairOrder || part?.requestId);
}

export function normalizeUsedParts(parts, minimumRows = 0) {
  const rows = Array.isArray(parts) ? parts.map((part) => ({
    partNo: String(part?.partNo || ""),
    qty: part?.qty === null || part?.qty === undefined ? "" : String(part.qty),
    repairOrder: String(part?.repairOrder || ""),
    ...(part?.requestId ? { requestId: part.requestId } : {}),
  })) : [];
  const minimum = Math.max(0, Math.min(MAX_USED_PARTS, Number(minimumRows) || 0));
  while (rows.length > minimum && !usedPartHasValue(rows.at(-1))) rows.pop();
  while (rows.length < minimum) rows.push(emptyUsedPart());
  return rows.slice(0, MAX_USED_PARTS);
}

export function addUsedPart(parts) {
  const rows = normalizeUsedParts(parts);
  return rows.length >= MAX_USED_PARTS ? rows : [...rows, emptyUsedPart()];
}

export function removeUsedPart(parts, index, minimumRows = 0) {
  const rows = normalizeUsedParts(parts);
  const next = rows.filter((_, rowIndex) => rowIndex !== index);
  return normalizeUsedParts(next, minimumRows);
}

export function readonlyUsedParts(parts) {
  return normalizeUsedParts(parts).filter(usedPartHasValue);
}

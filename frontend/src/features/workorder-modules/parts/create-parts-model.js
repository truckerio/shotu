import {
  DEFAULT_UOM_CODE,
  getUnitDefinition,
  normalizeQuantity,
} from "../../../../../shared/units-of-measure.js";

function text(value) {
  return String(value || "").trim();
}

export function createPartHasContent(part = {}) {
  return Boolean(text(part.partNo) || text(part.qty) || text(part.repairOrder));
}

export function filledCreatePartIndexes(parts = []) {
  return parts.reduce((indexes, part, index) => {
    if (createPartHasContent(part)) indexes.push(index);
    return indexes;
  }, []);
}

export function firstBlankCreatePartIndex(parts = []) {
  return parts.findIndex((part) => !createPartHasContent(part));
}

export function invalidCreatePartIndex(parts = []) {
  return parts.findIndex((part) => {
    if (!createPartHasContent(part)) return false;
    const code = text(part.uomCode || DEFAULT_UOM_CODE).toLowerCase();
    return !getUnitDefinition(code) || !normalizeQuantity(part.qty, code);
  });
}

export function createPartRenderIndexes(parts = [], editingIndex = -1) {
  const indexes = new Set(filledCreatePartIndexes(parts));
  if (editingIndex >= 0 && editingIndex < parts.length) indexes.add(editingIndex);
  return [...indexes].sort((left, right) => left - right);
}

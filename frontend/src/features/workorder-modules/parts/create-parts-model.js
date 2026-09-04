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
    const definition = getUnitDefinition(code);
    if (!definition || !normalizeQuantity(part.qty, code)) return true;
    if (!createPartRequiresSerializedUnits(part)) return false;
    return serializedUnitIds(part).length !== Number(normalizeQuantity(part.qty, code));
  });
}

export function createPartRequiresSerializedUnits(part = {}) {
  if (!text(part.catalogPartId) || part.serializationRequired !== true) return false;
  const definition = getUnitDefinition(text(part.uomCode || DEFAULT_UOM_CODE).toLowerCase());
  return ["count", "packaging"].includes(definition?.category)
    && Number(definition?.decimalScale) === 0;
}

export function serializedUnitIds(part = {}) {
  return [...new Set((Array.isArray(part.serializedUnitIds) ? part.serializedUnitIds : [])
    .map(text)
    .filter(Boolean))];
}

export function serializedSelectionMatchesQuantity(part = {}) {
  if (!createPartRequiresSerializedUnits(part)) return true;
  const quantity = Number(normalizeQuantity(part.qty, part.uomCode));
  return Number.isInteger(quantity) && quantity > 0 && serializedUnitIds(part).length === quantity;
}

export function serializedSelectionPatch(units = [], selectedIds = []) {
  const ids = selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const selectedUnits = units.filter((unit) => ids.has(unit.id));
  return {
    qty: selectedUnits.length ? String(selectedUnits.length) : "",
    serializedUnitIds: selectedUnits.map((unit) => unit.id),
    serializedSerialNumbers: selectedUnits.map((unit) => unit.serialNumber),
  };
}

export function createPartRenderIndexes(parts = [], editingIndex = -1) {
  const indexes = new Set(filledCreatePartIndexes(parts));
  if (editingIndex >= 0 && editingIndex < parts.length) indexes.add(editingIndex);
  return [...indexes].sort((left, right) => left - right);
}

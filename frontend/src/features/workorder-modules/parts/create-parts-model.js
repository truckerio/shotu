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

export function serializedUnitRows(part = {}, selection = part) {
  const rawIds = Array.isArray(selection?.serializedUnitIds) ? selection.serializedUnitIds : [];
  const rawSerials = Array.isArray(selection?.serializedSerialNumbers) ? selection.serializedSerialNumbers : [];
  const seen = new Set();
  return rawIds.flatMap((unitId, index) => {
    const id = text(unitId);
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const serialNumber = text(rawSerials[index]);
    return [{
      ...part,
      qty: "1",
      serializationRequired: true,
      serializedUnitIds: [id],
      serializedSerialNumbers: serialNumber ? [serialNumber] : [],
    }];
  });
}

export function independentSerializedPartRows(parts = []) {
  let reusableBlankRows = 0;
  const expanded = parts.flatMap((part) => {
    const rows = serializedUnitRows(part);
    reusableBlankRows += Math.max(0, rows.length - 1);
    return rows.length ? rows : [part];
  });
  while (reusableBlankRows > 0) {
    const blankIndex = expanded.findLastIndex((part) => !createPartHasContent(part));
    if (blankIndex < 0) break;
    expanded.splice(blankIndex, 1);
    reusableBlankRows -= 1;
  }
  return expanded;
}

export function serializedUnitSlots(parts = [], partIndex = -1, maximumRows = 18) {
  const occupiedByOtherParts = parts.reduce((count, part, index) => (
    index !== partIndex && createPartHasContent(part) ? count + 1 : count
  ), 0);
  return Math.max(0, maximumRows - occupiedByOtherParts);
}

export function serializedUnitIdsOutsidePart(parts = [], partIndex = -1) {
  return new Set(parts.flatMap((part, index) => (
    index === partIndex ? [] : serializedUnitIds(part)
  )));
}

export function replacePartWithSerializedUnitRows(parts = [], partIndex = -1, selection = {}, maximumRows = 18) {
  if (partIndex < 0 || partIndex >= parts.length) return parts;
  const excludedIds = serializedUnitIdsOutsidePart(parts, partIndex);
  const availableSlots = serializedUnitSlots(parts, partIndex, maximumRows);
  const rows = serializedUnitRows(parts[partIndex], selection);
  if (!rows.length || rows.length > availableSlots || rows.some((row) => excludedIds.has(row.serializedUnitIds[0]))) return parts;

  const next = parts.flatMap((part, index) => index === partIndex ? rows : [part]);
  let reusableBlankRows = Math.max(0, rows.length - 1);
  while (reusableBlankRows > 0) {
    const blankIndex = next.findLastIndex((part) => !createPartHasContent(part));
    if (blankIndex < 0) break;
    next.splice(blankIndex, 1);
    reusableBlankRows -= 1;
  }
  while (next.length > maximumRows) {
    const blankIndex = next.findLastIndex((part) => !createPartHasContent(part));
    if (blankIndex < 0) break;
    next.splice(blankIndex, 1);
  }
  return next.slice(0, maximumRows);
}

export function createPartRenderIndexes(parts = [], editingIndex = -1) {
  const indexes = new Set(filledCreatePartIndexes(parts));
  if (editingIndex >= 0 && editingIndex < parts.length) indexes.add(editingIndex);
  return [...indexes].sort((left, right) => left - right);
}

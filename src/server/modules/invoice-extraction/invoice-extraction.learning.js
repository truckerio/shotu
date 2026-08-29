import crypto from "node:crypto";
import { normalizeVendorKey } from "./invoice-extraction.schemas.js";

const REQUIRED_CONFIDENCE_PATHS = [
  "documentType", "vendorName", "invoiceNumber", "invoiceDate", "currency", "total",
];

export function reconciliationWarnings(draft, tolerance = 0.02) {
  const warnings = [];
  const lineTotals = draft.lines.map((line) => line.lineTotal.value);
  const missingLineTotals = lineTotals.some((value) => value === null || value === undefined);
  const lineTotal = lineTotals.reduce((sum, value) => sum + (Number(value) || 0), 0);
  const subtotal = draft.subtotal.value;
  if (subtotal !== null && !lineTotals.length) {
    warnings.push("No line totals were extracted; compare the invoice lines to subtotal.");
  } else if (subtotal !== null && missingLineTotals) {
    warnings.push("Some line totals were not extracted; compare the invoice lines to subtotal.");
  } else if (subtotal !== null && Math.abs(lineTotal - subtotal) > tolerance) {
    warnings.push("Line totals do not reconcile to subtotal.");
  }
  const components = [draft.subtotal.value, draft.tax.value, draft.shipping.value];
  if (draft.total.value !== null && components.every((value) => value !== null)) {
    const calculated = components.reduce((sum, value) => sum + value, 0);
    if (Math.abs(calculated - draft.total.value) > tolerance) warnings.push("Subtotal, tax, and shipping do not reconcile to total.");
  }
  return warnings;
}

export function extractionNeedsReview(draft, threshold = 90) {
  if (REQUIRED_CONFIDENCE_PATHS.some((path) => draft[path].confidence < threshold)) return true;
  if (draft.lines.some((line) => [line.partNumber, line.description, line.quantity, line.unitOfMeasure, line.unitPrice, line.lineTotal]
    .some((field) => field.confidence < threshold))) return true;
  return draft.warnings.length > 0 || reconciliationWarnings(draft).length > 0;
}

function comparableValue(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "value")) return value.value;
  return value;
}

export function correctionEvents(predicted, reviewed) {
  const events = [];
  const compare = (before, after, path) => {
    if (Array.isArray(before) || Array.isArray(after)) return;
    if (before && after && typeof before === "object" && typeof after === "object") {
      for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if (["confidence", "evidence", "warnings"].includes(key)) continue;
        compare(before[key], after[key], path ? `${path}.${key}` : key);
      }
      return;
    }
    const left = comparableValue(before);
    const right = comparableValue(after);
    if (JSON.stringify(left) === JSON.stringify(right)) return;
    events.push({
      fieldPath: path,
      predictedValue: left === undefined ? null : left,
      reviewedValue: right === undefined ? null : right,
      correctionType: left === undefined || left === null || left === "" ? "added" : right === undefined || right === null || right === "" ? "removed" : "changed",
    });
  };
  compare(predicted, reviewed, "");

  const beforeLines = new Map(predicted.lines.map((line) => [line.id, line]));
  const afterLines = new Map(reviewed.lines.map((line) => [line.id, line]));
  for (const lineId of new Set([...beforeLines.keys(), ...afterLines.keys()])) {
    const before = beforeLines.get(lineId);
    const after = afterLines.get(lineId);
    if (!before || !after) {
      events.push({
        fieldPath: `lines.${lineId}`,
        predictedValue: before || null,
        reviewedValue: after || null,
        correctionType: before ? "removed" : "added",
      });
      continue;
    }
    compare(before, after, `lines.${lineId}`);
  }
  return events;
}

export function semanticCandidatesFromCorrections(predicted, reviewed, events) {
  const vendorKey = normalizeVendorKey(reviewed.vendorName.value);
  if (!vendorKey) return [];
  return events.flatMap((event) => {
    if (event.fieldPath === "vendorName.value" && event.predictedValue) {
      return [{ vendorKey, factType: "vendor_alias", factKey: normalizeVendorKey(event.predictedValue), factValue: reviewed.vendorName.value }];
    }
    const partMatch = /^lines\.([^.]*)\.partNumber\.value$/.exec(event.fieldPath);
    if (partMatch && event.predictedValue && event.reviewedValue) {
      return [{ vendorKey, factType: "vendor_part_number_correction", factKey: String(event.predictedValue), factValue: event.reviewedValue }];
    }
    return [];
  }).filter((candidate) => candidate.factKey && candidate.factValue !== "" && candidate.factValue !== null)
    .map((candidate) => ({
    ...candidate,
    factValueHash: crypto.createHash("sha256").update(JSON.stringify(candidate.factValue)).digest("hex"),
  }));
}

export function reviewRequestHash({ reviewedDraft, approveLearning, approveGlobalStructureContribution, confirmNoLineItems }) {
  return crypto.createHash("sha256").update(JSON.stringify({
    reviewedDraft,
    approveLearning,
    approveGlobalStructureContribution,
    confirmNoLineItems,
  })).digest("hex");
}

export function memorySnapshot(memory) {
  return {
    semanticFacts: memory.semanticFacts.map(({ id, version }) => ({ id, version })),
    playbooks: memory.playbooks.map(({ id, version }) => ({ id, version })),
    trainingExamples: (memory.trainingExamples || []).map(({ id, label_version: labelVersion, labelVersion: camelLabelVersion }) => ({
      id,
      labelVersion: Number(labelVersion ?? camelLabelVersion ?? 1),
    })),
  };
}

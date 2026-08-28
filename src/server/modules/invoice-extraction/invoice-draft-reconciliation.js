const REVIEW_CONFIDENCE = 90;
const CONFLICT_CONFIDENCE_CAP = REVIEW_CONFIDENCE - 1;

const SCALAR_FIELDS = Object.freeze([
  "documentType",
  "vendorName",
  "vendorAccount",
  "invoiceNumber",
  "invoiceDate",
  "purchaseOrderNumber",
  "currency",
  "subtotal",
  "tax",
  "shipping",
  "total",
]);

const LINE_FIELDS = Object.freeze([
  "partNumber",
  "description",
  "quantity",
  "unitOfMeasure",
  "unitPrice",
  "lineTotal",
]);

const FIELD_LABELS = Object.freeze({
  documentType: "Document type",
  vendorName: "Vendor name",
  vendorAccount: "Vendor account",
  invoiceNumber: "Invoice number",
  invoiceDate: "Invoice date",
  purchaseOrderNumber: "Purchase order number",
  currency: "Currency",
  subtotal: "Subtotal",
  tax: "Tax",
  shipping: "Shipping",
  total: "Invoice total",
  partNumber: "part number",
  description: "description",
  quantity: "quantity",
  unitOfMeasure: "unit",
  unitPrice: "unit price",
  lineTotal: "line total",
});

function boundedConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function cloneField(field) {
  return {
    value: field?.value ?? null,
    confidence: boundedConfidence(field?.confidence),
    evidence: String(field?.evidence || "").slice(0, 500),
  };
}

function cloneLine(line) {
  return {
    id: line.id,
    ...Object.fromEntries(LINE_FIELDS.map((field) => [field, cloneField(line[field])])),
  };
}

function reviewableLocalLine(line, index, localSource) {
  return {
    ...cloneLine(line),
    id: `line-${index + 1}`,
    ...Object.fromEntries(LINE_FIELDS.map((fieldName) => {
      const candidate = cloneField(line[fieldName]);
      return [fieldName, {
        ...candidate,
        confidence: Math.min(candidate.confidence, CONFLICT_CONFIDENCE_CAP),
        evidence: appendEvidence(candidate.evidence, `Filled from ${sourceLabel(localSource)}; review required.`),
      }];
    })),
  };
}

function cloneDraft(draft) {
  return {
    ...Object.fromEntries(SCALAR_FIELDS.map((field) => [field, cloneField(draft[field])])),
    lines: (draft.lines || []).map(cloneLine),
    warnings: [...(draft.warnings || [])],
  };
}

function meaningfulValue(fieldName, value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return false;
  if (fieldName === "documentType" && normalized.toLowerCase() === "unknown") return false;
  if (fieldName === "currency" && normalized.toUpperCase() === "UNKNOWN") return false;
  return true;
}

function normalizedValue(fieldName, value) {
  if (typeof value === "number") return value;
  const normalized = String(value).normalize("NFKC").trim().toLocaleLowerCase("en-US");
  if (fieldName === "partNumber") return normalized.replace(/[^a-z0-9]+/g, "");
  return normalized.replace(/\s+/g, " ");
}

function valuesAgree(fieldName, primaryValue, localValue) {
  const left = normalizedValue(fieldName, primaryValue);
  const right = normalizedValue(fieldName, localValue);
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) <= 0.000001;
  }
  return left === right;
}

function sourceLabel(source) {
  if (source === "openai") return "OpenAI extraction";
  if (source === "local_ocr") return "local OCR";
  return String(source || "extraction source").replaceAll("_", " ");
}

function appendEvidence(evidence, note) {
  return [String(evidence || "").trim(), note].filter(Boolean).join(" ").slice(0, 500);
}

function reconcileField({ fieldName, primaryField, localField, primarySource, localSource, warningPrefix = "" }) {
  const primary = cloneField(primaryField);
  const local = cloneField(localField);
  const primaryMeaningful = meaningfulValue(fieldName, primary.value);
  const localMeaningful = meaningfulValue(fieldName, local.value) && local.confidence > 0;

  if (!primaryMeaningful && localMeaningful) {
    const label = warningPrefix || FIELD_LABELS[fieldName] || fieldName;
    return {
      field: {
        ...local,
        confidence: Math.min(local.confidence, CONFLICT_CONFIDENCE_CAP),
        evidence: appendEvidence(local.evidence, `Filled from ${sourceLabel(localSource)}; review required.`),
      },
      warning: `${label} was missing from ${sourceLabel(primarySource)} and was filled from ${sourceLabel(localSource)}; review required.`,
    };
  }

  if (!primaryMeaningful || !localMeaningful) return { field: primary, warning: null };

  if (valuesAgree(fieldName, primary.value, local.value)) {
    return {
      field: {
        ...primary,
        // The remote extractor receives OCR text as context, so agreement is
        // correlated evidence and must not manufacture extra confidence.
        confidence: primary.confidence,
        evidence: appendEvidence(primary.evidence, `Agreed with ${sourceLabel(localSource)}.`),
      },
      warning: null,
    };
  }

  const label = warningPrefix || FIELD_LABELS[fieldName] || fieldName;
  return {
    field: {
      ...primary,
      confidence: Math.min(primary.confidence, CONFLICT_CONFIDENCE_CAP),
      evidence: appendEvidence(primary.evidence, `Conflicts with ${sourceLabel(localSource)}; review required.`),
    },
    warning: `${label} differs between ${sourceLabel(primarySource)} and ${sourceLabel(localSource)}; kept the ${sourceLabel(primarySource)} value for review.`,
  };
}

function normalizedPartNumber(line) {
  const value = line?.partNumber?.value;
  return meaningfulValue("partNumber", value) ? normalizedValue("partNumber", value) : "";
}

function matchLocalLines(primaryLines, localLines) {
  const matches = new Map();
  const usedLocalIndexes = new Set();
  const localByPartNumber = new Map();

  localLines.forEach((line, index) => {
    const partNumber = normalizedPartNumber(line);
    if (!partNumber) return;
    const indexes = localByPartNumber.get(partNumber) || [];
    indexes.push(index);
    localByPartNumber.set(partNumber, indexes);
  });

  primaryLines.forEach((line, primaryIndex) => {
    const partNumber = normalizedPartNumber(line);
    const candidates = partNumber ? localByPartNumber.get(partNumber) || [] : [];
    if (candidates.length !== 1 || usedLocalIndexes.has(candidates[0])) return;
    matches.set(primaryIndex, candidates[0]);
    usedLocalIndexes.add(candidates[0]);
  });

  return matches;
}

/**
 * Reconciles two already-shaped invoice draft candidates without inventing data.
 * The primary draft owns output shape, line identity, ordering, and final warnings.
 */
export function reconcileInvoiceDrafts({
  primaryDraft,
  localDraft,
  primarySource = "openai",
  localSource = "local_ocr",
}) {
  const reconciled = cloneDraft(primaryDraft);
  const local = localDraft ? cloneDraft(localDraft) : null;
  if (!local) return reconciled;

  const reconciliationWarnings = [];
  for (const fieldName of SCALAR_FIELDS) {
    const result = reconcileField({
      fieldName,
      primaryField: reconciled[fieldName],
      localField: local[fieldName],
      primarySource,
      localSource,
    });
    reconciled[fieldName] = result.field;
    if (result.warning) reconciliationWarnings.push(result.warning);
  }

  if (!reconciled.lines.length && local.lines.length) {
    reconciled.lines = local.lines.map((line, index) => reviewableLocalLine(line, index, localSource));
    reconciliationWarnings.push(`${sourceLabel(primarySource)} found no invoice lines; added ${local.lines.length} line${local.lines.length === 1 ? "" : "s"} from ${sourceLabel(localSource)} for review.`);
  }

  const lineMatches = matchLocalLines(reconciled.lines, local.lines);
  reconciled.lines = reconciled.lines.map((line, lineIndex) => {
    const localIndex = lineMatches.get(lineIndex);
    if (localIndex === undefined) return line;
    const localLine = local.lines[localIndex];
    const nextLine = { ...line };
    for (const fieldName of LINE_FIELDS) {
      const result = reconcileField({
        fieldName,
        primaryField: nextLine[fieldName],
        localField: localLine[fieldName],
        primarySource,
        localSource,
        warningPrefix: `Line ${lineIndex + 1} ${FIELD_LABELS[fieldName] || fieldName}`,
      });
      nextLine[fieldName] = result.field;
      if (result.warning) reconciliationWarnings.push(result.warning);
    }
    return nextLine;
  });

  // Local OCR bootstrap warnings describe the fallback candidate, not reconciled truth.
  reconciled.warnings = [...new Set([...reconciled.warnings, ...reconciliationWarnings])].slice(0, 50);
  return reconciled;
}

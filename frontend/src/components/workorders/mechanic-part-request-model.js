import {
  DEFAULT_UOM_CODE,
  getUnitDefinition,
  normalizeQuantity,
} from "../../../../shared/units-of-measure.js";

export function mechanicPartsActionState(allowedActions = {}) {
  const canRecordUsedPart = allowedActions.recordUsedParts === true;
  const canRequestPart = allowedActions.requestParts === true;
  return {
    canRecordUsedPart,
    canRequestPart,
    available: [
      ...(canRecordUsedPart ? ["used"] : []),
      ...(canRequestPart ? ["request"] : []),
    ],
  };
}

export function createMechanicPartRequestDraft() {
  return {
    query: "",
    catalogPartId: "",
    partNumber: "",
    quantity: "1",
    uomCode: DEFAULT_UOM_CODE,
  };
}

export function validateMechanicPartRequest(draft) {
  const query = String(draft?.query || "").trim();
  const uomCode = String(draft?.uomCode || "").trim().toLowerCase();
  const unit = getUnitDefinition(uomCode);
  const normalizedQuantity = unit ? normalizeQuantity(draft?.quantity, uomCode) : "";
  const errors = {};

  if (query.length < 2) errors.query = "Describe the part using at least 2 characters.";
  else if (query.length > 500) errors.query = "Keep the part description under 500 characters.";

  if (!unit) errors.uomCode = "Choose a valid unit.";
  else if (!normalizedQuantity) {
    const quantity = Number(draft?.quantity);
    errors.quantity = unit.decimalScale === 0 && Number.isFinite(quantity) && quantity > 0
      ? "Use a whole number for this unit."
      : "Enter a quantity greater than 0.";
  }

  return {
    errors,
    payload: Object.keys(errors).length ? null : {
      ...(draft?.catalogPartId ? { catalogPartId: draft.catalogPartId } : {}),
      query,
      description: query,
      ...(draft?.partNumber ? { partNumber: String(draft.partNumber).trim() } : {}),
      quantity: Number(normalizedQuantity),
      uomCode,
    },
  };
}

function validationIssues(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      return validationIssues(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (typeof value === "object") {
    if (Array.isArray(value.issues)) return value.issues;
    return validationIssues(value.error);
  }
  return [];
}

export function mechanicPartRequestErrorFields(error) {
  const supportedFields = new Set(["query", "description", "quantity", "uomCode"]);
  const issues = [
    ...validationIssues(error?.details),
    ...validationIssues(error?.message),
  ];
  return issues.reduce((fields, issue) => {
    const field = Array.isArray(issue?.path)
      ? issue.path.find((part) => supportedFields.has(part))
      : null;
    if (field && typeof issue.message === "string") {
      fields[field === "description" ? "query" : field] = issue.message;
    }
    return fields;
  }, {});
}

export const MAX_REFERENCE_NUMBERS = 20;

export function hasRefreshedPartIdentityVersion(item, pending) {
  return Boolean(
    item
    && pending
    && item.catalogPartId === pending.catalogPartId
    && String(item.version) !== String(pending.version),
  );
}

export function partIdentityConflict(error) {
  if (error?.code === "INVENTORY_PART_STALE") {
    return {
      kind: "stale",
      message: "This part was changed elsewhere. Reload details before saving.",
    };
  }

  if (error?.code === "INVENTORY_PART_IDENTITY_CONFLICT") {
    return {
      kind: "identity",
      message: error.message || "This part identity conflicts with an existing part. Correct the fields and try again.",
    };
  }

  return {
    kind: "identity",
    message: error?.message || "This part identity conflicts with an existing part. Correct the fields and try again.",
  };
}

function text(value) {
  return String(value || "").trim();
}

function normalizedIdentity(value) {
  return text(value).toLocaleUpperCase("en-US").replace(/[^A-Z0-9]/g, "");
}

export function createPartIdentityDraft(part = {}) {
  return {
    description: String(part.description || ""),
    partNumber: String(part.partNumber || ""),
    manufacturer: String(part.manufacturer || ""),
    category: String(part.category || ""),
    barcode: String(part.barcode || ""),
    uomCode: String(part.uomCode || "ea"),
    referenceNumbers: (part.referenceNumbers || []).map((value) => ({
      id: crypto.randomUUID(),
      value: String(value || ""),
    })),
  };
}

export function validatePartIdentityDraft(draft) {
  const errors = {};
  const partNumber = text(draft.partNumber);
  const description = text(draft.description);
  const references = draft.referenceNumbers || [];
  const seen = new Set();

  if (!description) errors.description = "Enter a part name.";
  if (!partNumber) errors.partNumber = "Enter a primary part number.";

  references.forEach((reference, index) => {
    const value = text(reference.value);
    if (!value) return;
    const normalized = normalizedIdentity(value);
    if (normalized === normalizedIdentity(partNumber)) {
      errors[`reference-${reference.id}`] = "A reference number cannot match the primary part number.";
    } else if (seen.has(normalized)) {
      errors[`reference-${reference.id}`] = "Reference numbers must be unique.";
    }
    seen.add(normalized);
    if (index >= MAX_REFERENCE_NUMBERS) errors.referenceNumbers = `Use at most ${MAX_REFERENCE_NUMBERS} reference numbers.`;
  });

  return errors;
}

export function partIdentityPayload(draft, expectedVersion) {
  return {
    expectedVersion,
    description: text(draft.description),
    partNumber: text(draft.partNumber),
    manufacturer: text(draft.manufacturer),
    category: text(draft.category),
    barcode: text(draft.barcode),
    uomCode: text(draft.uomCode),
    referenceNumbers: (draft.referenceNumbers || []).map((reference) => text(reference.value)).filter(Boolean),
  };
}

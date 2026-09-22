import { getUnitDefinition } from "../../../../shared/units-of-measure.js";
import { receiptLinePayload } from "../office/receipt-lines-model.js";

export function restoreReceiptDraft(stored, fresh) {
  if (!stored || typeof stored !== "object" || typeof stored.locationId !== "string") return fresh;
  // A submitted command must be recovered at its original location before a new receipt.
  if (stored.attempt) return stored;
  if (fresh.locationId && stored.locationId !== fresh.locationId) return fresh;
  return { ...fresh, ...stored };
}

export function directArrivalReceiptFacts(part) {
  return [{
    invoiceLineIndex: 0,
    partNumber: String(part?.partNumber || "Part"),
    description: String(part?.description || ""),
    uomCode: String(part?.canonicalUomCode || part?.uomCode || ""),
    trackingMode: part?.trackingMode || null,
    receiptMode: "direct-arrival",
  }];
}

export function directArrivalInitialLines(part, draft = {}) {
  if (Array.isArray(draft.receiptLines)) return draft.receiptLines;
  const held = draft.disposition === "held";
  const quantity = String(draft.quantity || "");
  return [{
    ...directArrivalReceiptFacts(part)[0],
    acceptedQuantity: held ? "" : quantity,
    heldQuantity: held ? quantity : "",
    rejectedQuantity: "",
    notReceivedQuantity: "",
    outcome: held ? "held" : "available",
    notes: String(draft.damageDetails || ""),
    holdLocation: String(draft.holdLocation || ""),
    serialNumbers: String(draft.serials || ""),
    targetPositionId: held ? "" : String(draft.targetPositionId || ""),
  }];
}

function directLineDraft(draft) {
  if (!Array.isArray(draft.receiptLines)) return draft;
  const lines = receiptLinePayload(draft.receiptLines);
  if (lines.length !== 1) throw new Error("Enter the one arrival line before receiving stock.");
  const [line] = lines;
  if (line.rejectedQuantity || line.notReceivedQuantity || !["accepted", "held"].includes(line.outcome)) throw new Error("Direct arrivals can be recorded as available or held for inspection.");
  if (line.outcome === "held" && (line.acceptedQuantity || !line.heldQuantity)) throw new Error("Held arrivals need a received quantity, hold location, and findings.");
  if (line.outcome === "accepted" && line.heldQuantity) throw new Error("Choose Held for inspection before recording held goods.");
  return {
    ...draft,
    quantity: String(line.acceptedQuantity + line.heldQuantity),
    serials: line.serialNumbers.join("\n"),
    disposition: line.outcome === "held" ? "held" : "accepted",
    targetPositionId: line.targetPositionId || "",
    holdLocation: line.holdLocation,
    damageDetails: line.notes,
  };
}

export function directReceiptPayload(part, draft, idempotencyKey) {
  draft = directLineDraft(draft);
  const serialNumbers = String(draft.serials || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const serialized = part.trackingMode === "serialized";
  const quantity = serialized ? serialNumbers.length : Number(draft.quantity);
  const uomCode = part.canonicalUomCode || part.uomCode;
  const unit = getUnitDefinition(uomCode);
  const expectedPartVersion = Number(part.version);
  if (part.catalogPartId && (!Number.isSafeInteger(expectedPartVersion) || expectedPartVersion <= 0)) throw new Error("Refresh the part before adding it to inventory.");
  if (!draft.locationId) throw new Error("Choose the location where the goods arrived.");
  const noPurchaseOrderReason = String(draft.noPurchaseOrderReason || "").trim();
  if (!part.purchaseLineId && !noPurchaseOrderReason) throw new Error("Explain why these goods arrived without a purchase order.");
  if (!["quantity", "serialized", "measured_bulk"].includes(part.trackingMode)) throw new Error("Review the part's tracking in Edit part first.");
  if (!unit || unit.category === "time" || !Number.isFinite(quantity) || quantity <= 0 || quantity > 999999.999 || Math.round(quantity * 10 ** unit.decimalScale) / 10 ** unit.decimalScale !== quantity) throw new Error("Enter a valid amount in the displayed stocking unit.");
  if (serialized && (serialNumbers.length > 500 || serialNumbers.some((value) => value.length > 100))) throw new Error("Receive up to 500 units, with at most 100 characters per identity.");
  if (serialized && new Set(serialNumbers.map((value) => value.toUpperCase())).size !== serialNumbers.length) throw new Error("Each captured identity must be different.");
  if (!draft.confirmed) throw new Error("Confirm that these new company-owned goods have physically arrived in the stated condition.");
  return { ...(part.catalogPartId?{catalogPartId:part.catalogPartId,expectedPartVersion}:{}), trackingMode: part.trackingMode,
    locationId: draft.locationId, uomCode, quantity, serialNumbers: serialized ? serialNumbers : [],
    ...(draft.disposition !== "held" && draft.targetPositionId ? { targetPositionId: draft.targetPositionId } : {}),
    ...(draft.disposition==='held'?{disposition:'held',holdLocation:draft.holdLocation,damageDetails:draft.damageDetails}:{}),
    ...(part.purchaseLineId ? { purchaseLineId: part.purchaseLineId } : {}),
    ...(part.purchaseRequestId ? {purchaseRequestId:part.purchaseRequestId,expectedRequestVersion:part.expectedRequestVersion} : {}),
    ...(!part.purchaseLineId ? { noPurchaseOrderReason } : {}),
    reference: String(draft.reference || "").trim(), idempotencyKey, confirmation: "new_company_stock_received" };
}

export function directReceiptErrorMessage(error) {
  if (error?.code === "INVENTORY_DIRECT_RECEIPT_APPROVAL_FORBIDDEN") return "This arrival requires purchasing approval. Save the reason and ask an approver to complete it.";
  if (error?.code === "INVENTORY_DIRECT_RECEIPT_APPROVAL_STALE") return "This approval request changed. Refresh it before continuing.";
  return error?.message || "Receipt outcome is unknown. Check the receipt before continuing.";
}

export function receiptDraftKey(actorId, companyId, catalogPartId) {
  return `inventory-direct-receipt:v1:${actorId}:${companyId}:${catalogPartId}`;
}

import { receiptStoragePositions } from "../inventory/storage-position-picker-model.js";
import { classifyInvoiceInventoryLines } from "../../../../shared/invoice-inventory-lines.js";

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function receiptLineLimit(line) {
  if (line?.receiptMode === "direct-arrival") return Number.POSITIVE_INFINITY;
  if (line?.inventoryDisposition === "financial_offset") return 0;
  const invoiceQuantity = number(line?.invoiceQuantity);
  return line?.remainingQuantity === null ? invoiceQuantity : Math.min(invoiceQuantity, number(line?.remainingQuantity));
}

export function receiptLineFacts(draft, suggestion) {
  const inventoryFacts = classifyInvoiceInventoryLines(draft?.lines || []);
  return (draft?.lines || []).map((line, invoiceLineIndex) => {
    const match = suggestion?.candidates?.find((candidate) => Number(candidate.invoiceLineIndex) === invoiceLineIndex);
    const serverFact = suggestion?.receiptLines?.find((candidate) => Number(candidate.invoiceLineIndex) === invoiceLineIndex);
    const candidate = match?.candidate || serverFact || {};
    const inventoryFact = inventoryFacts[invoiceLineIndex];
    const inventoryDisposition = serverFact?.inventoryDisposition || inventoryFact?.inventoryDisposition || "stock";
    return {
      invoiceLineIndex,
      partNumber: String(line?.partNumber?.value || "Part"),
      description: String(line?.description?.value || ""),
      uomCode: String(candidate.uom_code || serverFact?.uomCode || line?.unitOfMeasure?.value || ""),
      invoiceQuantity: inventoryDisposition === "financial_offset"
        ? number(line?.quantity?.value)
        : number(match?.invoiceOutstandingQuantity ?? serverFact?.invoiceOutstandingQuantity ?? line?.quantity?.value),
      remainingQuantity: candidate.outstanding_quantity === undefined ? null : number(candidate.outstanding_quantity),
      trackingMode: candidate.tracking_mode || serverFact?.trackingMode || null,
      purchaseLineId: match?.purchaseLineId || serverFact?.purchaseLineId || null,
      inventoryDisposition,
      offsetLineIndex: serverFact?.offsetLineIndex ?? inventoryFact?.offsetLineIndex ?? null,
    };
  });
}

export function initialReceiptLines(draft, suggestion) {
  return initialReceiptLinesFromFacts(receiptLineFacts(draft, suggestion));
}

export function initialReceiptLinesFromFacts(facts, initialLines = null) {
  return (facts || []).map((line, index) => ({
    ...line,
    acceptedQuantity: "",
    heldQuantity: "",
    rejectedQuantity: "",
    notReceivedQuantity: "",
    outcome: "available",
    notes: "",
    holdLocation: "",
    serialNumbers: "",
    targetPositionId: "",
    ...(initialLines?.[index] || {}),
  }));
}

export function normalizeReceiptLineTarget(line, positions = []) {
  const targetPositionId = String(line.targetPositionId || "");
  const acceptedQuantity = number(line.acceptedQuantity);
  const eligible = new Set(receiptStoragePositions(positions).map((position) => position.id));
  if (acceptedQuantity <= 0 || (targetPositionId && !eligible.has(targetPositionId))) return { ...line, targetPositionId: "" };
  return line;
}

export function updateReceiptLine(line, field, value, positions = []) {
  return normalizeReceiptLineTarget({ ...line, [field]: value }, positions);
}

export function receiveAllReceiptLines(lines) {
  return (lines || []).map((line) => ({
    ...line,
    acceptedQuantity: line.inventoryDisposition === "financial_offset" ? "" : String(receiptLineLimit(line)),
    heldQuantity: "",
    rejectedQuantity: "",
    notReceivedQuantity: "",
    outcome: "available",
    notes: "",
    holdLocation: "",
    // Exact identities remain a physical entry, including when every unit arrived.
    serialNumbers: "",
  }));
}

export function receiptLinePayload(lines) {
  return lines.filter((line) => line.inventoryDisposition !== "financial_offset").map((line) => {
    const acceptedQuantity = number(line.acceptedQuantity);
    const payload = {
      invoiceLineIndex: line.invoiceLineIndex,
      acceptedQuantity,
      heldQuantity: number(line.heldQuantity),
      rejectedQuantity: number(line.rejectedQuantity),
      notReceivedQuantity: number(line.notReceivedQuantity),
      outcome: line.outcome === "available" ? "accepted" : line.outcome,
      notes: String(line.notes || "").trim(),
      holdLocation: String(line.holdLocation || "").trim(),
      serialNumbers: line.trackingMode === "serialized"
        ? String(line.serialNumbers || "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
        : [],
    };
    if (line.purchaseLineId) payload.purchaseLineId = line.purchaseLineId;
    if (acceptedQuantity > 0 && String(line.targetPositionId || "").trim()) payload.targetPositionId = String(line.targetPositionId).trim();
    return payload;
  }).filter((line) => line.acceptedQuantity + line.heldQuantity + line.rejectedQuantity + line.notReceivedQuantity > 0);
}

export function receiptLinesReady(lines) {
  if ((lines || []).some((line) => line.inventoryDisposition !== "financial_offset" && !line.trackingMode)) return false;
  const payload = receiptLinePayload(lines);
  const received = payload.some((line) => line.acceptedQuantity + line.heldQuantity + line.rejectedQuantity + line.notReceivedQuantity > 0);
  if (!received) return false;
  return payload.every((line) => {
    const receivedQuantity = line.acceptedQuantity + line.heldQuantity + line.rejectedQuantity + line.notReceivedQuantity;
    const source = lines.find((candidate) => candidate.invoiceLineIndex === line.invoiceLineIndex);
    const limit = receiptLineLimit(source);
    const directArrival = source?.receiptMode === "direct-arrival";
    if (!directArrival && receivedQuantity > limit && line.outcome !== "over") return false;
    if (line.outcome === "over" && receivedQuantity <= limit) return false;
    if (line.outcome === "over" && (line.acceptedQuantity > limit || line.heldQuantity <= 0)) return false;
    if (directArrival) {
      if (!["accepted", "held"].includes(line.outcome)) return false;
      if (line.rejectedQuantity > 0 || line.notReceivedQuantity > 0) return false;
      if (line.outcome === "accepted" && line.heldQuantity > 0) return false;
      if (line.outcome === "held" && (line.acceptedQuantity > 0 || line.heldQuantity <= 0 || !line.holdLocation || !line.notes)) return false;
    } else if (line.outcome !== "accepted" && !line.notes) return false;
    if (!directArrival && line.outcome === "accepted" && (line.heldQuantity > 0 || line.rejectedQuantity > 0 || line.notReceivedQuantity > 0)) return false;
    if (["damaged", "wrong"].includes(line.outcome) && line.heldQuantity + line.rejectedQuantity <= 0) return false;
    if (line.outcome === "wrong" && line.acceptedQuantity > 0) return false;
    if (line.outcome === "short" && (line.notReceivedQuantity <= 0 || line.heldQuantity > 0 || line.rejectedQuantity > 0)) return false;
    if (line.heldQuantity > 0 && (!line.holdLocation || !line.notes)) return false;
    if (source?.trackingMode === "serialized") {
      const acceptedIdentities = line.serialNumbers.length;
      if (acceptedIdentities !== line.acceptedQuantity + line.heldQuantity) return false;
      if (new Set(line.serialNumbers.map((value) => value.toUpperCase())).size !== acceptedIdentities) return false;
    }
    return true;
  });
}

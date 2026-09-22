import { z } from "zod";
import { suggestPurchaseInvoiceAllocations } from "../../db/repositories/inventory-purchase-invoice-allocation.repo.js";
import { query } from "../../db/pool.js";
import { resolveInventoryLocationScope } from "./inventory-effective-scope.js";
import { InventoryError } from "./inventory.errors.js";

const id = z.string().uuid();
const querySchema = z.object({ runId: id }).strict();

export async function getPurchaseInvoiceSuggestions(searchParams, requestContext, dependencies = {}) {
  const input = querySchema.parse(Object.fromEntries(searchParams));
  const loadLocation = dependencies.loadInvoiceLocation || (async (runId) => {
    const result = await query("select location_id from invoice_extraction_runs where id=$1 and company_id=any($2::uuid[])", [runId, [...requestContext.companyIds]]);
    return result.rows[0] || null;
  });
  const result = await loadLocation(input.runId);
  if (!result?.location_id) return { kind: "not_found" };
  const scope = await resolveInventoryLocationScope(requestContext, result.location_id, { loadLocation: dependencies.loadLocation, code: "PURCHASE_INVOICE_FORBIDDEN", message: "Purchase invoice matching is outside your inventory scope." });
  return (dependencies.suggest || suggestPurchaseInvoiceAllocations)({
    runId: input.runId,
    companyIds: scope.companyIds,
    locationIds: scope.locationIds,
    isAdmin: scope.isAdmin,
  });
}

export function validateInvoicePostingRoute({ draft, postingRoute, allocationPlan, receiptLines, noPurchaseOrderReason }) {
  const hasPo = Boolean(String(draft?.purchaseOrderNumber?.value || "").trim());
  const route = postingRoute || (hasPo ? "purchase_order" : "no_purchase_order");
  if (route === "purchase_order" && !hasPo) {
    throw new InventoryError("A purchase order number is required before allocating this invoice to a PO.", { code: "PURCHASE_INVOICE_PO_REQUIRED", statusCode: 409 });
  }
  if (route === "purchase_order" && !allocationPlan?.length && !receiptLines?.every((line) => line.purchaseLineId)) {
    throw new InventoryError("Choose an exact purchase order allocation before adding this invoice to inventory.", { code: "PURCHASE_INVOICE_ALLOCATION_REQUIRED", statusCode: 409 });
  }
  if (route === "no_purchase_order" && !String(noPurchaseOrderReason || "").trim()) {
    throw new InventoryError("Explain why this invoice is being received without a purchase order.", { code: "PURCHASE_INVOICE_ROUTE_REQUIRED", statusCode: 409 });
  }
  if (route === "no_purchase_order" && allocationPlan?.length) {
    throw new InventoryError("A no-PO receipt cannot include purchase order allocations.", { code: "PURCHASE_INVOICE_ROUTE_CONFLICT", statusCode: 409 });
  }
  if (route === "no_purchase_order" && receiptLines?.some((line) => line.purchaseLineId)) {
    throw new InventoryError("A no-PO receipt cannot include purchase order line references.", { code: "PURCHASE_INVOICE_ROUTE_CONFLICT", statusCode: 409 });
  }
  return route;
}

export function validateCompleteInvoiceAllocationPlan({ lines, receiptLines = null, allocationPlan }) {
  const expected = receiptLines
    ? receiptLines.filter((line) => Number(line.usableQuantity) > 0)
    : lines.map((line, index) => ({ invoiceLineIndex: line.lineIndex ?? index, usableQuantity: line.quantity }));
  if (allocationPlan.length !== expected.length) {
    throw new InventoryError("Allocate every invoice line's accepted quantity exactly once before adding inventory.", { code: "PURCHASE_INVOICE_ALLOCATION_INCOMPLETE", statusCode: 409 });
  }
  const expectedByIndex = new Map(expected.map((line) => [line.invoiceLineIndex, Number(line.usableQuantity)]));
  const seen = new Set();
  for (const allocation of allocationPlan) {
    if (seen.has(allocation.invoiceLineIndex) || !expectedByIndex.has(allocation.invoiceLineIndex)
      || Number(allocation.quantity) !== expectedByIndex.get(allocation.invoiceLineIndex)) {
      throw new InventoryError("Each accepted invoice quantity must have one exact purchase order allocation.", { code: "PURCHASE_INVOICE_ALLOCATION_INCOMPLETE", statusCode: 409 });
    }
    seen.add(allocation.invoiceLineIndex);
  }
  if (seen.size !== expected.length) throw new InventoryError("Allocate every invoice line's accepted quantity exactly once before adding inventory.", { code: "PURCHASE_INVOICE_ALLOCATION_INCOMPLETE", statusCode: 409 });
}

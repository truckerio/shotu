import { validLaborQuantity } from "../../../../shared/labor-product.js";

// Product snapshots are resolved from the local catalog before they are persisted.
export function assertWorkorderLaborQuantity(formData) {
  const quantity = String(formData?.laborHours ?? "").trim();
  if (!quantity) return;
  if (!validLaborQuantity(quantity, formData?.laborProduct?.uomCode || "hr")) {
    const error = new Error("Enter a positive labor quantity; flat services require whole numbers.");
    error.statusCode = 400;
    error.code = "WORKORDER_LABOR_QUANTITY_INVALID";
    throw error;
  }
}

export class InventoryError extends Error {
  constructor(message, { code = "inventory_failed", statusCode = 500, retryable = false } = {}) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

const CATALOG_UOM_CONSTRAINTS = new Set([
  "catalog_uom_activity_uom_mismatch",
  "parts_catalog_uom_locked",
]);

export function catalogUomConflictError(error) {
  if (!CATALOG_UOM_CONSTRAINTS.has(error?.constraint)) return null;
  return new InventoryError("The inventory unit changed. Refresh the part and try again.", {
    code: "CATALOG_UOM_CHANGED",
    statusCode: 409,
    retryable: true,
  });
}

export function inventoryNotFound() {
  return new InventoryError("Inventory identity was not found.", {
    code: "inventory_not_found",
    statusCode: 404,
  });
}

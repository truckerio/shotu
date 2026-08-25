export class InventoryError extends Error {
  constructor(message, { code = "inventory_failed", statusCode = 500, retryable = false } = {}) {
    super(message);
    this.name = "InventoryError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export function inventoryNotFound() {
  return new InventoryError("Inventory identity was not found.", {
    code: "inventory_not_found",
    statusCode: 404,
  });
}

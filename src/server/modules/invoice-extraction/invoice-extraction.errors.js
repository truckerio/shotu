export class InvoiceExtractionError extends Error {
  constructor(message, { code = "invoice_extraction_failed", statusCode = 500, retryable = false } = {}) {
    super(message);
    this.name = "InvoiceExtractionError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

export function invoiceNotFound() {
  return new InvoiceExtractionError("Invoice extraction was not found.", {
    code: "invoice_extraction_not_found",
    statusCode: 404,
  });
}

export function invoiceConflict(currentVersion) {
  const error = new InvoiceExtractionError("This invoice review changed. Reload it before approving.", {
    code: "invoice_extraction_conflict",
    statusCode: 409,
  });
  error.currentVersion = currentVersion;
  return error;
}

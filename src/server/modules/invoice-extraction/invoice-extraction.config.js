export const invoiceExtractionConfig = Object.freeze({
  get openAiApiKey() {
    return String(process.env.OPENAI_API_KEY || "").trim();
  },
  get openAiBaseUrl() {
    return String(process.env.OPENAI_API_BASE_URL || "https://api.openai.com/v1").trim();
  },
  get model() {
    return String(process.env.INVOICE_EXTRACTION_OPENAI_MODEL || "gpt-5.6-terra").trim();
  },
  get maxConcurrentExtractions() {
    const value = Number.parseInt(process.env.INVOICE_EXTRACTION_MAX_CONCURRENT || "4", 10);
    return Number.isSafeInteger(value) ? Math.min(20, Math.max(1, value)) : 4;
  },
  get ocrBaseUrl() {
    return String(process.env.INVOICE_OCR_BASE_URL || "").trim();
  },
  get ocrToken() {
    return String(process.env.INVOICE_OCR_TOKEN || "").trim();
  },
  get ocrTimeoutMs() {
    const value = Number.parseInt(process.env.INVOICE_OCR_TIMEOUT_MS || "60000", 10);
    return Number.isSafeInteger(value) ? Math.min(120_000, Math.max(5_000, value)) : 60_000;
  },
  get ocrMaxConcurrent() {
    const value = Number.parseInt(process.env.INVOICE_OCR_MAX_CONCURRENT || "1", 10);
    return Number.isSafeInteger(value) ? Math.min(4, Math.max(1, value)) : 1;
  },
  get workerMaxAttempts() {
    const value = Number.parseInt(process.env.INVOICE_EXTRACTION_WORKER_MAX_ATTEMPTS || "2", 10);
    return Number.isSafeInteger(value) ? Math.min(5, Math.max(1, value)) : 2;
  },
  get workerConcurrency() {
    const value = Number.parseInt(process.env.INVOICE_EXTRACTION_WORKER_CONCURRENCY || "2", 10);
    return Number.isSafeInteger(value) ? Math.min(4, Math.max(1, value)) : 2;
  },
  get templatePromotionExamples() {
    const value = Number.parseInt(process.env.INVOICE_TEMPLATE_PROMOTION_EXAMPLES || "3", 10);
    return Number.isSafeInteger(value) ? Math.min(10, Math.max(3, value)) : 3;
  },
  get documentEncryptionKey() {
    return String(process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY || "").trim();
  },
  get documentEncryptionKeyVersion() {
    return String(process.env.INVOICE_DOCUMENT_ENCRYPTION_KEY_VERSION || "v1").trim() || "v1";
  },
  get documentRetentionDays() {
    const value = Number.parseInt(process.env.INVOICE_DOCUMENT_RETENTION_DAYS || "365", 10);
    return Number.isSafeInteger(value) ? Math.min(3650, Math.max(1, value)) : 365;
  },
  promptVersion: "invoice-v1",
  maxDocumentBytes: 10 * 1024 * 1024,
  maxLines: 250,
  confidenceThreshold: 90,
});

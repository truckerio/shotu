import { getInvoiceExtractionWorkerSource, failInvoiceExtractionRun, loadInvoiceExtractionMemory, loadInvoiceLayoutTemplates } from "../../db/repositories/invoice-extractions.repo.js";
import { DATABASE_UUID_PATTERN } from "../../db/company.js";
import { registerIntegrationProvider } from "../../integrations/core/integration-provider.registry.js";
import { decryptInvoiceDocument } from "./invoice-document.crypto.js";
import { InvoiceExtractionError } from "./invoice-extraction.errors.js";
import { normalizeVendorKey } from "./invoice-extraction.schemas.js";
import { executeInvoiceExtractionRun } from "./invoice-extraction.service.js";

export async function processInvoiceExtractionJob(job, dependencies = {}) {
  const runId = String(job?.payload?.runId || "");
  const companyId = String(job?.company_id || "");
  if (!DATABASE_UUID_PATTERN.test(runId) || !DATABASE_UUID_PATTERN.test(companyId)) {
    throw new InvoiceExtractionError("Invoice extraction job is invalid.", {
      code: "invoice_job_invalid",
      statusCode: 422,
      retryable: false,
    });
  }
  const getSource = dependencies.getSource || getInvoiceExtractionWorkerSource;
  const source = await getSource({ runId, companyId });
  if (!source) return { skipped: true, reason: "run_not_processing" };
  const bytes = (dependencies.decryptDocument || decryptInvoiceDocument)(source);
  const vendorHint = String(job.payload?.vendorHint || "").slice(0, 180);
  const vendorKey = normalizeVendorKey(vendorHint);
  const [memory, activeTemplates] = await Promise.all([
    (dependencies.loadMemory || loadInvoiceExtractionMemory)({
      companyId,
      vendorKey,
      factLimit: 20,
      playbookLimit: 5,
      exampleLimit: 3,
    }),
    (dependencies.loadTemplates || loadInvoiceLayoutTemplates)({
      companyId,
      vendorKey,
      statuses: ["active"],
      limit: 25,
    }),
  ]);
  const parsed = {
    locationId: source.location_id,
    fileName: source.file_name,
    mimeType: source.mime_type,
    dataUrl: `data:${source.mime_type};base64,${bytes.toString("base64")}`,
    vendorHint,
    idempotencyKey: `worker-${runId}`,
  };
  const startedAt = performance.now();
  try {
    return await (dependencies.execute || executeInvoiceExtractionRun)({
      run: { id: runId },
      location: { id: source.location_id, company_id: companyId },
      parsed,
      document: { bytes, byteSize: Number(source.byte_size), documentHash: source.content_sha256 },
      memory,
      activeTemplates,
    }, { ...dependencies, deferFailure: true });
  } catch (error) {
    const safe = error instanceof InvoiceExtractionError
      ? error
      : new InvoiceExtractionError("Invoice extraction failed.", { code: "provider_error", statusCode: 502, retryable: true });
    const finalAttempt = Number(job.attempts) >= Number(job.max_attempts);
    if (!safe.retryable || finalAttempt) {
      await (dependencies.failRun || failInvoiceExtractionRun)({
        runId,
        companyId,
        errorCode: safe.code,
        retryable: safe.retryable,
        durationMs: Math.round(performance.now() - startedAt),
      });
      safe.terminal = true;
    }
    throw safe;
  }
}

export const invoiceExtractionWorkerAdapter = registerIntegrationProvider({
  provider: "invoice_extraction",
  capabilities: ["background_jobs"],
  jobs: {
    extract(job) {
      return processInvoiceExtractionJob(job);
    },
  },
});

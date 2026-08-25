import { z } from "zod";
import { invoiceExtractionConfig } from "../invoice-extraction.config.js";
import { InvoiceExtractionError } from "../invoice-extraction.errors.js";

let activeOcrRequests = 0;

const ocrRegionSchema = z.object({
  text: z.string().max(1000),
  confidence: z.number().min(0).max(1),
  pageNumber: z.number().int().min(1).max(100),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  polygon: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(3).max(20),
}).strict();

const ocrResponseSchema = z.object({
  provider: z.literal("paddleocr"),
  providerVersion: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  text: z.string().max(500_000),
  pageCount: z.number().int().min(1).max(10),
  regions: z.array(ocrRegionSchema).max(5_000),
  durationMs: z.number().int().min(0).max(600_000),
}).strict();

function validatedBaseUrl(value, { production = process.env.NODE_ENV === "production" } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch {
    throw new InvoiceExtractionError("Local invoice OCR is not configured correctly.", {
      code: "ocr_not_configured",
      statusCode: 503,
    });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new InvoiceExtractionError("Local invoice OCR is not configured correctly.", {
      code: "ocr_not_configured",
      statusCode: 503,
    });
  }
  const isLoopback = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (production && parsed.protocol !== "https:" && !isLoopback) {
    throw new InvoiceExtractionError("Local invoice OCR requires a secure endpoint.", {
      code: "ocr_not_configured",
      statusCode: 503,
    });
  }
  return parsed.toString().replace(/\/$/, "");
}

export function ocrObservation(result, { pageNumber = 1 } = {}) {
  return {
    width: 1,
    height: 1,
    regions: result.regions.filter((region) => region.pageNumber === pageNumber),
  };
}

export async function extractInvoiceWithLocalOcr(input, options = {}) {
  const config = options.config || invoiceExtractionConfig;
  const fetchFn = options.fetchFn || fetch;
  const baseUrl = validatedBaseUrl(config.ocrBaseUrl, { production: options.production });
  const timeoutMs = Math.min(120_000, Math.max(5_000, Number(options.timeoutMs || config.ocrTimeoutMs) || 60_000));
  const maxConcurrent = Math.min(4, Math.max(1, Number(config.ocrMaxConcurrent) || 1));
  if (activeOcrRequests >= maxConcurrent) {
    throw new InvoiceExtractionError("Invoice OCR is busy. Try again shortly.", {
      code: "ocr_capacity",
      statusCode: 503,
      retryable: true,
    });
  }
  activeOcrRequests += 1;
  let response;
  try {
    response = await fetchFn(`${baseUrl}/v1/ocr`, {
      method: "POST",
      headers: {
        "content-type": input.mimeType,
        "content-length": String(input.bytes.length),
        ...(config.ocrToken ? { "x-ocr-token": config.ocrToken } : {}),
      },
      body: input.bytes,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new InvoiceExtractionError("Local invoice OCR is unavailable.", {
      code: error?.name === "TimeoutError" ? "ocr_timeout" : "ocr_unavailable",
      statusCode: 503,
      retryable: true,
    });
  } finally {
    activeOcrRequests -= 1;
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new InvoiceExtractionError("Local invoice OCR could not process this document.", {
      code: response.status === 413 ? "document_too_large" : "ocr_failed",
      statusCode: response.status === 413 ? 413 : 502,
      retryable: response.status >= 500,
    });
  }
  const parsed = ocrResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.text.trim() || !parsed.data.regions.length) {
    throw new InvoiceExtractionError("Local invoice OCR returned no usable text.", {
      code: "ocr_empty_result",
      statusCode: 422,
    });
  }
  return parsed.data;
}

export { ocrResponseSchema };

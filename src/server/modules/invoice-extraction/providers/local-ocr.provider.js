import { z } from "zod";
import { invoiceExtractionConfig } from "../invoice-extraction.config.js";
import { InvoiceExtractionError } from "../invoice-extraction.errors.js";

let activeOcrRequests = 0;

function requestTimeout(timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Request timed out", "TimeoutError")), timeoutMs);
  timer.unref?.();
  return { controller, timer };
}

async function boundedJson(response, maxBytes) {
  const limit = Math.min(32 * 1024 * 1024, Math.max(64 * 1024, Number(maxBytes) || 16 * 1024 * 1024));
  let total = 0;
  const chunks = [];
  const add = (value) => {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > limit) {
      throw new InvoiceExtractionError("Local invoice OCR returned too much data.", {
        code: "ocr_response_too_large",
        statusCode: 502,
        retryable: true,
      });
    }
    chunks.push(chunk);
  };
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        add(value);
      }
    } finally {
      reader.releaseLock?.();
    }
  } else if (response.body?.[Symbol.asyncIterator]) {
    for await (const chunk of response.body) add(chunk);
  } else if (typeof response.text === "function") add(await response.text());
  else if (typeof response.json === "function") add(JSON.stringify(await response.json()));
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch (error) {
    if (error instanceof InvoiceExtractionError) throw error;
    return {};
  }
}

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

const nativePdfTextSchema = z.object({
  provider: z.literal("pdfium"),
  providerVersion: z.string().min(1).max(80),
  text: z.string().max(100_000),
  pageCount: z.number().int().min(1).max(10),
  characterCount: z.number().int().min(0).max(100_000),
  durationMs: z.number().int().min(0).max(600_000),
}).strict();

function validatedBaseUrl(value, {
  production = process.env.NODE_ENV === "production",
  token = invoiceExtractionConfig.ocrToken,
} = {}) {
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
  const isAuthenticatedRailwayPrivate = parsed.hostname.endsWith(".railway.internal") && Boolean(String(token || "").trim());
  if (production && parsed.protocol !== "https:" && !isLoopback && !isAuthenticatedRailwayPrivate) {
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
  const baseUrl = validatedBaseUrl(config.ocrBaseUrl, {
    production: options.production,
    token: config.ocrToken,
  });
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
  const timeout = requestTimeout(timeoutMs);
  try {
    response = await fetchFn(`${baseUrl}/v1/ocr`, {
      method: "POST",
      headers: {
        "content-type": input.mimeType,
        "content-length": String(input.bytes.length),
        ...(config.ocrToken ? { "x-ocr-token": config.ocrToken } : {}),
      },
      body: input.bytes,
      signal: timeout.controller.signal,
    });
  } catch (error) {
    throw new InvoiceExtractionError("Local invoice OCR is unavailable.", {
      code: error?.name === "TimeoutError" ? "ocr_timeout" : "ocr_unavailable",
      statusCode: 503,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout.timer);
    activeOcrRequests -= 1;
  }
  const body = await boundedJson(response, config.ocrMaxResponseBytes);
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

export async function extractNativePdfText(input, options = {}) {
  if (input.mimeType !== "application/pdf") {
    throw new InvoiceExtractionError("Native text extraction requires a PDF.", {
      code: "native_pdf_required",
      statusCode: 415,
    });
  }
  const config = options.config || invoiceExtractionConfig;
  const fetchFn = options.fetchFn || fetch;
  const baseUrl = validatedBaseUrl(config.ocrBaseUrl, {
    production: options.production,
    token: config.ocrToken,
  });
  const timeoutMs = Math.min(15_000, Math.max(1_000, Number(options.timeoutMs) || 10_000));
  let response;
  const timeout = requestTimeout(timeoutMs);
  try {
    response = await fetchFn(`${baseUrl}/v1/native-text`, {
      method: "POST",
      headers: {
        "content-type": "application/pdf",
        "content-length": String(input.bytes.length),
        ...(config.ocrToken ? { "x-ocr-token": config.ocrToken } : {}),
      },
      body: input.bytes,
      signal: timeout.controller.signal,
    });
  } catch (error) {
    throw new InvoiceExtractionError("Native PDF text extraction is unavailable.", {
      code: error?.name === "TimeoutError" ? "native_pdf_timeout" : "native_pdf_unavailable",
      statusCode: 503,
      retryable: true,
    });
  } finally {
    clearTimeout(timeout.timer);
  }
  const body = await boundedJson(response, config.ocrMaxResponseBytes);
  if (!response.ok) {
    throw new InvoiceExtractionError("Native PDF text extraction failed.", {
      code: response.status === 413 ? "document_too_large" : "native_pdf_failed",
      statusCode: response.status === 413 ? 413 : 502,
      retryable: response.status >= 500,
    });
  }
  const parsed = nativePdfTextSchema.safeParse(body);
  if (!parsed.success) {
    throw new InvoiceExtractionError("Native PDF text extraction returned an invalid result.", {
      code: "native_pdf_invalid_result",
      statusCode: 502,
      retryable: true,
    });
  }
  return parsed.data;
}

export { nativePdfTextSchema, ocrResponseSchema };

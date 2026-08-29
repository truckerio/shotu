import { ZodError } from "zod";
import { InvoiceExtractionError } from "./invoice-extraction.errors.js";
import { extractInvoice, readInvoiceExtraction, readInvoiceSource, reextractInvoice, reviewInvoice } from "./invoice-extraction.service.js";

function runPath(pathname, suffix = "") {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^/api/office/invoice-extractions/([^/]+)${escaped}$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

function sendError(sendJson, res, error) {
  if (error instanceof ZodError) {
    sendJson(res, 400, { error: "Invalid invoice extraction request.", code: "validation_error", issues: error.issues });
    return;
  }
  if (error instanceof InvoiceExtractionError) {
    sendJson(res, error.statusCode, {
      error: error.message,
      code: error.code,
      retryable: error.retryable,
      ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
    });
    return;
  }
  throw error;
}

export async function handleInvoiceExtractionApi(req, res, url, helpers, dependencies = {}) {
  if (!url.pathname.startsWith("/api/office/invoice-extractions")) return false;
  try {
    if (req.method === "POST" && url.pathname === "/api/office/invoice-extractions") {
      const result = await extractInvoice(await helpers.readBody(req), helpers.requestContext, {
        ...dependencies,
        deferProcessing: dependencies.deferProcessing ?? true,
      });
      helpers.sendJson(res, result.replayed ? 200 : 202, result);
      return true;
    }
    const reviewId = runPath(url.pathname, "/review");
    if (req.method === "POST" && reviewId) {
      helpers.sendJson(res, 200, await reviewInvoice(reviewId, await helpers.readBody(req), helpers.requestContext, dependencies));
      return true;
    }
    const reextractId = runPath(url.pathname, "/reextract");
    if (req.method === "POST" && reextractId) {
      const result = await reextractInvoice(reextractId, await helpers.readBody(req), helpers.requestContext, {
        ...dependencies,
        deferProcessing: dependencies.deferProcessing ?? true,
      });
      helpers.sendJson(res, result.replayed ? 200 : 202, result);
      return true;
    }
    const sourceId = runPath(url.pathname, "/source");
    if (req.method === "GET" && sourceId) {
      const source = await readInvoiceSource(sourceId, helpers.requestContext, dependencies);
      res.writeHead(200, {
        "content-type": source.mimeType,
        "content-length": source.byteSize,
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      });
      res.end(source.bytes);
      return true;
    }
    const runId = runPath(url.pathname);
    if (req.method === "GET" && runId) {
      helpers.sendJson(res, 200, await readInvoiceExtraction(runId, helpers.requestContext, dependencies));
      return true;
    }
    helpers.sendJson(res, 404, { error: "Unknown invoice extraction route.", code: "route_not_found" });
    return true;
  } catch (error) {
    sendError(helpers.sendJson, res, error);
    return true;
  }
}

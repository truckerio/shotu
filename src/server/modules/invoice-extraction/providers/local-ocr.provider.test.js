import assert from "node:assert/strict";
import test from "node:test";
import { extractInvoiceWithLocalOcr, ocrObservation } from "./local-ocr.provider.js";

function response(overrides = {}) {
  return {
    provider: "paddleocr",
    providerVersion: "2.10.0",
    confidence: 0.95,
    text: "PARTS INVOICE\nINV-1",
    pageCount: 1,
    regions: [{
      text: "INV-1", confidence: 0.95, pageNumber: 1,
      x: 0.7, y: 0.1, width: 0.1, height: 0.02,
      polygon: [[0.7, 0.1], [0.8, 0.1], [0.8, 0.12], [0.7, 0.12]],
    }],
    durationMs: 500,
    ...overrides,
  };
}

test("local OCR sends bounded raw bytes and returns positioned regions", async () => {
  let request;
  const result = await extractInvoiceWithLocalOcr({ bytes: Buffer.from("safe"), mimeType: "image/png" }, {
    production: false,
    config: { ocrBaseUrl: "http://127.0.0.1:8091", ocrTimeoutMs: 30_000, ocrMaxConcurrent: 1, ocrToken: "token" },
    fetchFn: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => response() };
    },
  });
  assert.equal(result.provider, "paddleocr");
  assert.equal(request.url, "http://127.0.0.1:8091/v1/ocr");
  assert.equal(request.options.headers["x-ocr-token"], "token");
  assert.deepEqual(request.options.body, Buffer.from("safe"));
  assert.equal(ocrObservation(result).regions.length, 1);
});

test("local OCR rejects malformed or empty provider output", async () => {
  await assert.rejects(() => extractInvoiceWithLocalOcr({ bytes: Buffer.from("safe"), mimeType: "image/png" }, {
    production: false,
    config: { ocrBaseUrl: "http://127.0.0.1:8091", ocrTimeoutMs: 30_000, ocrMaxConcurrent: 1, ocrToken: "" },
    fetchFn: async () => ({ ok: true, status: 200, json: async () => response({ text: "", regions: [] }) }),
  }), (error) => error.code === "ocr_empty_result");
});

test("production rejects an insecure non-loopback OCR endpoint", async () => {
  await assert.rejects(() => extractInvoiceWithLocalOcr({ bytes: Buffer.from("safe"), mimeType: "image/png" }, {
    production: true,
    config: { ocrBaseUrl: "http://ocr.internal", ocrTimeoutMs: 30_000, ocrMaxConcurrent: 1, ocrToken: "" },
  }), (error) => error.code === "ocr_not_configured");
});

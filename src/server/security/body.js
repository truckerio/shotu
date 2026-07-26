import {
  InvalidJsonBodyError,
  RequestBodyTooLargeError,
  UnsupportedMediaTypeError,
} from "./errors.js";

const DEFAULT_MAX_JSON_BYTES = 1_000_000;

function contentLength(req) {
  const raw = Array.isArray(req.headers?.["content-length"])
    ? req.headers["content-length"][0]
    : req.headers?.["content-length"];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isJsonContentType(value) {
  const mediaType = String(value || "").split(";")[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

export async function readJsonBody(req, {
  maxBytes = DEFAULT_MAX_JSON_BYTES,
  requireJsonContentType = true,
  emptyValue = {},
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new TypeError("maxBytes must be a positive safe integer.");
  }

  const declaredBytes = contentLength(req);
  if (declaredBytes !== null && declaredBytes > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }

  const contentType = req.headers?.["content-type"];
  if (requireJsonContentType && declaredBytes !== 0 && !isJsonContentType(contentType)) {
    throw new UnsupportedMediaTypeError(contentType);
  }

  const chunks = [];
  let receivedBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
    chunks.push(buffer);
  }

  if (receivedBytes === 0) return emptyValue;

  try {
    return JSON.parse(Buffer.concat(chunks, receivedBytes).toString("utf8"));
  } catch {
    throw new InvalidJsonBodyError();
  }
}

export { DEFAULT_MAX_JSON_BYTES, isJsonContentType };

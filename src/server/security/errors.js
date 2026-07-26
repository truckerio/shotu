export class SecurityHttpError extends Error {
  constructor(message, { code, statusCode, details } = {}) {
    super(message);
    this.name = "SecurityHttpError";
    this.code = code || "security_error";
    this.statusCode = statusCode || 400;
    this.details = details;
  }
}

export class OriginValidationError extends SecurityHttpError {
  constructor(message = "Request origin is not allowed.", details) {
    super(message, {
      code: "invalid_request_origin",
      statusCode: 403,
      details,
    });
    this.name = "OriginValidationError";
  }
}

export class RequestBodyTooLargeError extends SecurityHttpError {
  constructor(maxBytes) {
    super(`Request body exceeds the ${maxBytes} byte limit.`, {
      code: "request_body_too_large",
      statusCode: 413,
      details: { maxBytes },
    });
    this.name = "RequestBodyTooLargeError";
  }
}

export class InvalidJsonBodyError extends SecurityHttpError {
  constructor(message = "Request body must contain valid JSON.") {
    super(message, {
      code: "invalid_json_body",
      statusCode: 400,
    });
    this.name = "InvalidJsonBodyError";
  }
}

export class UnsupportedMediaTypeError extends SecurityHttpError {
  constructor(contentType) {
    super("Request body must use an application/json content type.", {
      code: "unsupported_media_type",
      statusCode: 415,
      details: { contentType: contentType || null },
    });
    this.name = "UnsupportedMediaTypeError";
  }
}

export class RateLimitExceededError extends SecurityHttpError {
  constructor(result) {
    super("Too many requests. Try again later.", {
      code: "rate_limit_exceeded",
      statusCode: 429,
      details: {
        limit: result.limit,
        remaining: result.remaining,
        resetAt: result.resetAt,
        retryAfterMs: result.retryAfterMs,
      },
    });
    this.name = "RateLimitExceededError";
    this.result = result;
  }
}

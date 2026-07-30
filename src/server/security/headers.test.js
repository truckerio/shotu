import assert from "node:assert/strict";
import test from "node:test";
import {
  applySecurityHeaders,
  productionSecurityHeaders,
} from "./headers.js";

test("production headers include transport, framing, MIME, and CSP protections", () => {
  const headers = productionSecurityHeaders({ production: true });

  assert.equal(headers["strict-transport-security"], "max-age=31536000; includeSubDomains");
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.match(headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(headers["content-security-policy"], /img-src 'self' data: blob: https:/);
  assert.match(headers["content-security-policy"], /script-src 'self'/);
  assert.doesNotMatch(headers["content-security-policy"], /svc\.webspellchecker\.net/);
  assert.doesNotMatch(headers["content-security-policy"], /(?:^|\s)'(?:wasm-)?unsafe-eval'(?:\s|;|$)/);
  assert.equal(headers["cross-origin-opener-policy"], "same-origin-allow-popups");
});

test("development headers omit HSTS and do not overwrite response-owned headers", () => {
  const stored = new Map([["x-frame-options", "SAMEORIGIN"]]);
  const response = {
    headersSent: false,
    hasHeader: (name) => stored.has(name),
    setHeader: (name, value) => stored.set(name, value),
  };

  assert.equal(applySecurityHeaders(response, { production: false }), true);
  assert.equal(stored.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(stored.has("strict-transport-security"), false);
  assert.equal(stored.get("x-content-type-options"), "nosniff");
});

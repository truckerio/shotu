const DEFAULT_CSP_DIRECTIVES = Object.freeze({
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "frame-ancestors": ["'none'"],
  "object-src": ["'none'"],
  "form-action": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "font-src": ["'self'", "data:"],
  "connect-src": ["'self'", "https:"],
  "worker-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
});

function contentSecurityPolicy(directives) {
  return Object.entries(directives)
    .filter(([, sources]) => sources !== false)
    .map(([name, sources]) => {
      const values = Array.isArray(sources) ? sources : [sources];
      return [name, ...values.filter(Boolean)].join(" ");
    })
    .join("; ");
}

export function productionSecurityHeaders({
  production = process.env.NODE_ENV === "production",
  cspDirectives = DEFAULT_CSP_DIRECTIVES,
  contentSecurityPolicyEnabled = true,
  hstsMaxAgeSeconds = 31_536_000,
} = {}) {
  const headers = {
    "cross-origin-opener-policy": "same-origin-allow-popups",
    "cross-origin-resource-policy": "same-origin",
    "origin-agent-cluster": "?1",
    "permissions-policy": "camera=(self), geolocation=(self), microphone=(self)",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };

  if (contentSecurityPolicyEnabled) {
    headers["content-security-policy"] = contentSecurityPolicy(cspDirectives);
  }

  if (production) {
    headers["strict-transport-security"] = `max-age=${hstsMaxAgeSeconds}; includeSubDomains`;
  }

  return headers;
}

export function applySecurityHeaders(res, options) {
  if (res.headersSent) return false;
  for (const [name, value] of Object.entries(productionSecurityHeaders(options))) {
    if (!res.hasHeader?.(name)) res.setHeader(name, value);
  }
  return true;
}

export { DEFAULT_CSP_DIRECTIVES };

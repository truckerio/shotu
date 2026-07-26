import assert from "node:assert/strict";
import test from "node:test";
import { OriginValidationError } from "./errors.js";
import { assertSameOriginMutation } from "./same-origin.js";

function request(method, headers = {}, encrypted = false) {
  return { method, headers, socket: { encrypted } };
}

test("safe requests bypass origin validation", () => {
  assert.deepEqual(assertSameOriginMutation(request("GET")), {
    checked: false,
    origin: null,
  });
});

test("configured public Railway origin accepts same-origin mutations", () => {
  const req = request("POST", {
    origin: "https://junior01.up.railway.app",
    host: "internal.railway",
    "x-forwarded-host": "junior01.up.railway.app",
    "x-forwarded-proto": "https",
  });

  assert.deepEqual(assertSameOriginMutation(req, {
    publicOrigin: "https://junior01.up.railway.app",
    trustProxy: true,
  }), {
    checked: true,
    origin: "https://junior01.up.railway.app",
  });
});

test("trusted proxy target origin works only when the forwarded host is allowed", () => {
  const req = request("PATCH", {
    origin: "https://junior01.up.railway.app",
    host: "internal.railway",
    "x-forwarded-host": "junior01.up.railway.app",
    "x-forwarded-proto": "https",
  });

  assert.doesNotThrow(() => assertSameOriginMutation(req, {
    trustProxy: true,
    trustedProxyHosts: ["junior01.up.railway.app"],
  }));
  assert.throws(
    () => assertSameOriginMutation(req, {
      trustProxy: true,
      trustedProxyHosts: ["other.example.com"],
    }),
    OriginValidationError,
  );
});

test("cross-origin, null-origin, malformed, and missing-origin mutations are rejected", () => {
  const options = { publicOrigin: "https://app.example.com" };

  for (const headers of [
    { origin: "https://attacker.example" },
    { origin: "null" },
    { origin: "not a URL" },
    {},
  ]) {
    assert.throws(
      () => assertSameOriginMutation(request("DELETE", headers), options),
      OriginValidationError,
    );
  }
});

test("a malformed Origin cannot fall back to an otherwise valid Referer", () => {
  assert.throws(
    () => assertSameOriginMutation(request("POST", {
      origin: "not a URL",
      referer: "https://app.example.com/workorders/1",
    }), {
      publicOrigin: "https://app.example.com",
    }),
    OriginValidationError,
  );
});

test("same-origin Referer is accepted when Origin is unavailable", () => {
  const result = assertSameOriginMutation(request("POST", {
    referer: "https://app.example.com/workorders/1",
  }), {
    allowedOrigins: ["https://app.example.com"],
  });

  assert.equal(result.origin, "https://app.example.com");
});

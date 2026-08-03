import assert from "node:assert/strict";
import test from "node:test";

import { apiErrorDetails } from "./api.js";

test("API errors normalize flat and structured server responses", () => {
  assert.deepEqual(apiErrorDetails({ error: "Not allowed", code: "forbidden" }), {
    code: "forbidden",
    message: "Not allowed",
  });
  assert.deepEqual(apiErrorDetails({
    error: { code: "INTEGRATION_AUTHENTICATION_REQUIRED", message: "Reconnect Samsara." },
  }), {
    code: "INTEGRATION_AUTHENTICATION_REQUIRED",
    message: "Reconnect Samsara.",
  });
});

test("API errors use a stable fallback instead of stringifying objects", () => {
  assert.deepEqual(apiErrorDetails({ error: {} }), {
    code: "",
    message: "Request failed",
  });
});

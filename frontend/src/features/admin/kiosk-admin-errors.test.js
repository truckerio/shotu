import assert from "node:assert/strict";
import test from "node:test";
import { kioskPinFieldError } from "./kiosk-admin-errors.js";

test("extracts a PIN validation message from the serialized API error shape", () => {
  const error = new Error('[{"code":"custom","path":["pin"],"message":"Choose a less common PIN."}]');
  error.details = { error: error.message };

  assert.equal(kioskPinFieldError(error), "Choose a less common PIN.");
});

test("extracts a PIN validation message from structured API issues", () => {
  const error = new Error("Invalid request");
  error.details = {
    error: "Invalid request",
    issues: [{
      code: "custom",
      path: ["pin"],
      message: "PIN must contain at least four digits.",
    }],
  };

  assert.equal(kioskPinFieldError(error), "PIN must contain at least four digits.");
});

test("leaves unrelated errors available for the page-level notice", () => {
  const error = new Error("Unable to reach the server.");

  assert.equal(kioskPinFieldError(error), "");
});

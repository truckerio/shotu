import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const mainSource = readFileSync(new URL("../main.jsx", import.meta.url), "utf8");
const loginSource = readFileSync(new URL("../features/auth/LoginPage.jsx", import.meta.url), "utf8");
const forgotSource = readFileSync(new URL("../features/auth/ForgotPasswordDialog.jsx", import.meta.url), "utf8");
const resetSource = readFileSync(new URL("../features/auth/ResetPasswordPage.jsx", import.meta.url), "utf8");

test("login exposes password recovery without requiring a session", () => {
  assert.match(loginSource, /Forgot password\?/);
  assert.match(loginSource, /<ForgotPasswordDialog/);
  assert.match(forgotSource, /authClient\.requestPasswordReset/);
  assert.match(forgotSource, /If that email has an account, a reset link has been sent\./);
});

test("reset callback renders before the authenticated application", () => {
  assert.match(mainSource, /resetPassword \? \(/);
  assert.match(mainSource, /<ResetPasswordPage token=\{resetToken\}/);
  assert.match(resetSource, /authClient\.resetPassword/);
  assert.match(resetSource, /minLength=\{12\}/);
});

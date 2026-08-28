import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dialogSource = readFileSync(new URL("./ChangePasswordDialog.jsx", import.meta.url), "utf8");
const profileSource = readFileSync(new URL("./ProfileMenu.jsx", import.meta.url), "utf8");

test("profile menu exposes shared self-service password management", () => {
  assert.match(profileSource, /account\.changePassword/);
  assert.match(profileSource, /<ChangePasswordDialog/);
  assert.match(profileSource, /locale=\{locale\}/);
});

test("password change verifies the current password and revokes other sessions", () => {
  assert.match(dialogSource, /authClient\.changePassword/);
  assert.match(dialogSource, /currentPassword: passwords\.current/);
  assert.match(dialogSource, /newPassword: passwords\.next/);
  assert.match(dialogSource, /revokeOtherSessions: true/);
});

test("password change enforces confirmation and the twelve-character policy", () => {
  assert.match(dialogSource, /passwords\.next\.length >= 12/);
  assert.match(dialogSource, /passwords\.next === passwords\.confirmation/);
  assert.match(dialogSource, /minLength=\{12\}/);
});

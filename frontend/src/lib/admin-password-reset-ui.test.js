import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("../features/admin/AdminWorkspace.jsx", import.meta.url);

test("admin user management sends recovery email without collecting passwords", async () => {
  const source = await readFile(workspaceUrl, "utf8");

  assert.match(source, /Send password reset/);
  assert.match(source, /password-reset-email/);
  assert.match(source, /Send reset email/);
  assert.match(source, /userAction\.user\.login_email \|\| userAction\.user\.email/);
  assert.doesNotMatch(source, /admin-new-password/);
  assert.doesNotMatch(source, /admin-confirm-password/);
});

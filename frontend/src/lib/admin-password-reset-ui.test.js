import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("../features/admin/AdminWorkspace.jsx", import.meta.url);

test("admin directly sets mechanic passwords while other roles keep email recovery", async () => {
  const source = await readFile(workspaceUrl, "utf8");

  assert.match(source, /user\.role === "mechanic" \? "password" : "password-reset-email"/);
  assert.match(source, /Set mechanic password/);
  assert.match(source, /No email is required/);
  assert.match(source, /admin-new-password/);
  assert.match(source, /admin-confirm-password/);
  assert.match(source, /`\$\{base\}\/password`/);
  assert.match(source, /Send password reset/);
  assert.match(source, /password-reset-email/);
  assert.match(source, /Send reset email/);
  assert.match(source, /userAction\.user\.login_email \|\| userAction\.user\.email/);
});

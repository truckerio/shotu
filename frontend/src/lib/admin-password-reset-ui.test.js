import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("../features/admin/AdminWorkspace.jsx", import.meta.url);
const usersUrl = new URL("../features/admin/workspace/UsersPage.jsx", import.meta.url);
const dialogUrl = new URL("../features/admin/workspace/AdminUserActionDialog.jsx", import.meta.url);

test("admin directly sets mechanic passwords while other roles keep email recovery", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const users = await readFile(usersUrl, "utf8");
  const dialog = await readFile(dialogUrl, "utf8");

  assert.match(users, /user\.role === "mechanic" \? "password" : "password-reset-email"/);
  assert.match(dialog, /Set mechanic password/);
  assert.match(dialog, /No email is required/);
  assert.match(dialog, /admin-new-password/);
  assert.match(dialog, /admin-confirm-password/);
  assert.match(source, /`\$\{base\}\/password`/);
  assert.match(dialog, /Send password reset/);
  assert.match(source, /`\$\{base\}\/password-reset-email`/);
  assert.doesNotMatch(source, /\/api\/admin\/users\/\$\{userAction\.user\.id\}\/password-reset-email/);
  assert.match(dialog, /Send reset email/);
  assert.match(dialog, /userAction\.user\.login_email \|\| userAction\.user\.email/);
});

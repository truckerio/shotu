import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("../../features/admin/AdminWorkspace.jsx", import.meta.url);
const dialogsUrl = new URL("../../features/admin/workspace/AdminLocationDialogs.jsx", import.meta.url);

test("admin invitation UI reports delivery truth and keeps a backup link", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const dialogs = await readFile(dialogsUrl, "utf8");

  assert.match(source, /setInviteDelivery\(result\.delivery \|\| \{ status: "failed" \}\)/);
  assert.match(dialogs, /inviteDelivery\?\.status === "sent"/);
  assert.match(dialogs, /An invitation email was sent/);
  assert.match(dialogs, /Email delivery is not configured\./);
  assert.match(dialogs, /The invitation was saved, but the email could not be sent\./);
  assert.match(dialogs, /Copy backup link/);
  assert.match(source, /timeoutMs: 30_000/);
  assert.doesNotMatch(source, /message: "Invitation created\."/);
});

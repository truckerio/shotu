import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("../../features/admin/AdminWorkspace.jsx", import.meta.url);

test("admin invitation UI reports delivery truth and keeps a backup link", async () => {
  const source = await readFile(workspaceUrl, "utf8");

  assert.match(source, /setInviteDelivery\(result\.delivery \|\| \{ status: "failed" \}\)/);
  assert.match(source, /result\.delivery\?\.status === "sent"/);
  assert.match(source, /Invitation email sent\./);
  assert.match(source, /Email delivery is not configured\./);
  assert.match(source, /The invitation was saved, but the email could not be sent\./);
  assert.match(source, /Copy backup link/);
  assert.match(source, /timeoutMs: 30_000/);
  assert.doesNotMatch(source, /message: "Invitation created\."/);
});

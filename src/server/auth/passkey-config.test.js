import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authUrl = new URL("./auth.js", import.meta.url);

test("auth enables secure session-bound passkey registration without replacing passwords", async () => {
  const source = await readFile(authUrl, "utf8");

  assert.match(source, /import \{ passkey \} from "@better-auth\/passkey"/);
  assert.match(source, /const authOrigin = new URL\(config\.baseURL\)\.origin/);
  assert.match(source, /const relyingPartyId = new URL\(authOrigin\)\.hostname/);
  assert.match(source, /emailAndPassword:\s*\{\s*enabled: true/);
  assert.match(source, /username\(\{/);
  assert.match(source, /passkey\(\{/);
  assert.match(source, /rpID: relyingPartyId/);
  assert.match(source, /origin: authOrigin/);
  assert.match(source, /residentKey: "required"/);
  assert.match(source, /userVerification: "required"/);
  assert.match(source, /registration:\s*\{\s*requireSession: true/);
});

test("passkey plugin maps credential fields to auth schema naming", async () => {
  const source = await readFile(authUrl, "utf8");

  assert.match(source, /modelName: "auth_passkey"/);
  for (const [field, column] of [
    ["publicKey", "public_key"],
    ["userId", "user_id"],
    ["credentialID", "credential_id"],
    ["deviceType", "device_type"],
    ["backedUp", "backed_up"],
    ["createdAt", "created_at"],
  ]) {
    assert.match(source, new RegExp(`${field}: "${column}"`));
  }
});

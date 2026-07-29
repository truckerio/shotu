import assert from "node:assert/strict";
import test from "node:test";
import {
  createIntegrationToken,
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  hashIntegrationToken,
  tokenPrefix,
} from "./integration-crypto.js";

const encryptionKey = Buffer.alloc(32, 11).toString("base64");
const context = {
  companyId: "11111111-1111-4111-8111-111111111111",
  provider: "samsara",
  accountId: "22222222-2222-4222-8222-222222222222",
  credentialKind: "oauth",
};

test("provider secrets round-trip through AES-GCM without plaintext output", () => {
  const secret = { accessToken: "secret-access", refreshToken: "secret-refresh" };
  const encrypted = encryptIntegrationSecret(secret, context, {
    encryptionKey,
    randomBytes: () => Buffer.alloc(12, 3),
  });
  assert.equal(encrypted.ciphertext.includes("secret"), false);
  assert.deepEqual(decryptIntegrationSecret(encrypted, context, { encryptionKey }), secret);
});

test("encrypted provider secrets are bound to tenant and provider context", () => {
  const encrypted = encryptIntegrationSecret({ token: "private" }, context, { encryptionKey });
  assert.throws(
    () => decryptIntegrationSecret(encrypted, { ...context, provider: "odoo" }, { encryptionKey }),
    /authenticate data|Unsupported state/i,
  );
});

test("integration client tokens expose a lookup prefix but store only a hash", () => {
  const generated = createIntegrationToken({
    randomBytes: (size) => Buffer.alloc(size, size),
  });
  assert.match(generated.token, /^wgi_[A-Za-z0-9_-]{8}\.[A-Za-z0-9_-]{32,}$/);
  assert.equal(tokenPrefix(generated.token), generated.prefix);
  assert.equal(generated.tokenHash, hashIntegrationToken(generated.token));
  assert.equal(generated.tokenHash.includes(generated.token), false);
});

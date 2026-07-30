import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isRejectedSamsaraOAuthCredential } from "./samsara.oauth.service.js";

test("invalid OAuth grants are treated as rejected credentials", () => {
  for (const code of ["invalid_grant", "invalid_client", "unauthorized_client"]) {
    assert.equal(isRejectedSamsaraOAuthCredential({ code }), true);
  }
  assert.equal(isRejectedSamsaraOAuthCredential({ code: "temporarily_unavailable" }), false);
  assert.equal(isRejectedSamsaraOAuthCredential(new Error("network failed")), false);
});

test("OAuth refresh falls back to the configured API token and clears rejected credentials", async () => {
  const source = await readFile(new URL("./samsara.oauth.service.js", import.meta.url), "utf8");
  assert.match(
    source,
    /catch \(error\) \{[\s\S]*?apiTokenFallback\(allowApiTokenFallback, companyId\)[\s\S]*?clearIntegrationOAuthCredentials/,
  );
  assert.match(source, /tokenEnvKey: "SAMSARA_API_TOKEN"/);
  assert.match(source, /return fallback;/);
});

test("credential cleanup removes legacy and encrypted OAuth secrets transactionally", async () => {
  const source = await readFile(
    new URL("../../db/repositories/integrations.repo.js", import.meta.url),
    "utf8",
  );
  const cleanup = source.slice(
    source.indexOf("export async function clearIntegrationOAuthCredentials"),
    source.indexOf("export async function upsertIntegrationStatus"),
  );
  assert.match(cleanup, /client\.query\("begin"\)/);
  assert.match(cleanup, /access_token = null/);
  assert.match(cleanup, /refresh_token = null/);
  assert.match(cleanup, /delete from integration_credentials/);
  assert.match(cleanup, /credential_kind = 'oauth'/);
  assert.match(cleanup, /client\.query\("commit"\)/);
  assert.match(cleanup, /client\.query\("rollback"\)/);
});

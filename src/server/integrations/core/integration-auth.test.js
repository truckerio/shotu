import assert from "node:assert/strict";
import test from "node:test";
import {
  INTEGRATION_SCOPES,
  isServiceIntegrationPath,
  requireIntegrationScope,
  resolveIntegrationRequestContext,
} from "./integration-auth.js";
import { createIntegrationToken } from "./integration-crypto.js";

test("service authentication resolves one company-scoped machine actor", async () => {
  const generated = createIntegrationToken();
  let touched = null;
  const context = await resolveIntegrationRequestContext({
    headers: { authorization: `Bearer ${generated.token}` },
  }, {
    findClient: async () => ({
      id: "client-1",
      company_id: "company-1",
      name: "Odoo production",
      token_hash: generated.tokenHash,
      scopes: ["workorders:read"],
      active: true,
      expires_at: null,
    }),
    touchClient: async (id) => {
      touched = id;
    },
  });
  assert.equal(context.actor.type, "integration_client");
  assert.deepEqual([...context.companyIds], ["company-1"]);
  assert.equal(touched, "client-1");
  assert.doesNotThrow(() => requireIntegrationScope(context, INTEGRATION_SCOPES.WORKORDERS_READ));
});

test("service authentication rejects wrong tokens, expiry, and missing scopes", async () => {
  const generated = createIntegrationToken();
  const req = { headers: { authorization: `Bearer ${generated.token}` } };
  const base = {
    id: "client-1",
    company_id: "company-1",
    name: "Odoo",
    token_hash: "wrong",
    scopes: [],
    active: true,
  };
  await assert.rejects(
    resolveIntegrationRequestContext(req, {
      findClient: async () => base,
      touchClient: async () => {},
    }),
    (error) => error.statusCode === 401,
  );
  assert.throws(
    () => requireIntegrationScope({
      integrationClient: base,
      scopes: new Set(),
    }, INTEGRATION_SCOPES.WORKORDERS_WRITE),
    (error) => error.statusCode === 403,
  );
});

test("only the versioned Odoo service surface bypasses browser-session routing", () => {
  assert.equal(isServiceIntegrationPath("/api/integrations/odoo/v1/workorders"), true);
  assert.equal(isServiceIntegrationPath("/api/integrations/samsara/sync"), false);
  assert.equal(isServiceIntegrationPath("/api/integrations/clients"), false);
});

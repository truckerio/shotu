import {
  findIntegrationClientByPrefix,
  touchIntegrationClient,
} from "./integration-clients.repo.js";
import { hashIntegrationToken, tokenPrefix } from "./integration-crypto.js";
import {
  integrationAuthenticationRequired,
  integrationPermissionDenied,
} from "./integration-errors.js";
import crypto from "node:crypto";

export const INTEGRATION_SCOPES = Object.freeze({
  WORKORDERS_READ: "workorders:read",
  WORKORDERS_WRITE: "workorders:write",
  ASSETS_SYNC: "assets:sync",
  WEBHOOKS_WRITE: "webhooks:write",
});

export function bearerToken(req) {
  const header = String(req.headers?.authorization || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() || "";
}

export async function resolveIntegrationRequestContext(req, dependencies = {}) {
  const findClient = dependencies.findClient || findIntegrationClientByPrefix;
  const touchClient = dependencies.touchClient || touchIntegrationClient;
  const token = bearerToken(req);
  const prefix = tokenPrefix(token);
  if (!prefix) throw integrationAuthenticationRequired();

  const client = await findClient(prefix);
  const tokenHash = hashIntegrationToken(token);
  const expired = client?.expires_at && new Date(client.expires_at).getTime() <= Date.now();
  const storedHash = String(client?.token_hash || "");
  const hashMatches = storedHash.length === tokenHash.length
    && crypto.timingSafeEqual(Buffer.from(storedHash), Buffer.from(tokenHash));
  if (!client?.active || expired || !hashMatches) {
    throw integrationAuthenticationRequired();
  }

  await touchClient(client.id);
  return {
    actor: {
      id: client.id,
      type: "integration_client",
      name: client.name,
    },
    integrationClient: client,
    scopes: new Set(client.scopes || []),
    companyIds: new Set([client.company_id]),
    companyId: client.company_id,
    sessionMode: "integration",
  };
}

export function requireIntegrationScope(context, scope) {
  if (!context?.integrationClient || !context.scopes?.has(scope)) {
    throw integrationPermissionDenied();
  }
  return context;
}

export function isServiceIntegrationPath(pathname) {
  return String(pathname || "").startsWith("/api/integrations/odoo/v1/");
}

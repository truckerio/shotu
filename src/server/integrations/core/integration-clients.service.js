import { z } from "zod";
import { getPool } from "../../db/pool.js";
import {
  insertIntegrationClient,
  listIntegrationClients,
  revokeIntegrationClient,
} from "./integration-clients.repo.js";
import { createIntegrationToken } from "./integration-crypto.js";
import { integrationNotFound } from "./integration-errors.js";
import { appendIntegrationAudit } from "./integration-platform.repo.js";

const AVAILABLE_SCOPES = new Set([
  "workorders:read",
  "workorders:write",
  "assets:sync",
  "webhooks:write",
]);

export const createIntegrationClientSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string()).min(1).max(12).transform((values, context) => {
    const scopes = [...new Set(values.map((value) => value.trim()))];
    for (const scope of scopes) {
      if (!AVAILABLE_SCOPES.has(scope)) {
        context.addIssue({ code: "custom", message: `Unsupported integration scope: ${scope}` });
      }
    }
    return scopes;
  }),
  expiresAt: z.string().datetime().nullable().optional(),
});

export async function createCompanyIntegrationClient(input, context) {
  const parsed = createIntegrationClientSchema.parse(input);
  const generated = createIntegrationToken();
  const transaction = await getPool().connect();
  try {
    await transaction.query("begin");
    const client = await insertIntegrationClient({
      client: transaction,
      companyId: context.companyId,
      name: parsed.name,
      tokenPrefix: generated.prefix,
      tokenHash: generated.tokenHash,
      scopes: parsed.scopes,
      expiresAt: parsed.expiresAt || null,
      createdByUserId: context.userId,
    });
    await appendIntegrationAudit({
      client: transaction,
      companyId: context.companyId,
      action: "integration_client.created",
      actorType: "user",
      actorId: context.userId,
      targetType: "integration_client",
      targetId: client.id,
      details: { name: client.name, scopes: client.scopes },
    });
    await transaction.query("commit");
    return { client, token: generated.token };
  } catch (error) {
    await transaction.query("rollback").catch(() => {});
    throw error;
  } finally {
    transaction.release();
  }
}

export function companyIntegrationClients(companyId) {
  return listIntegrationClients(companyId);
}

export async function revokeCompanyIntegrationClient(input, context) {
  const transaction = await getPool().connect();
  try {
    await transaction.query("begin");
    const client = await revokeIntegrationClient({
      client: transaction,
      companyId: context.companyId,
      clientId: input.clientId,
      revokedByUserId: context.userId,
    });
    if (!client) throw integrationNotFound("Integration client");
    await appendIntegrationAudit({
      client: transaction,
      companyId: context.companyId,
      action: "integration_client.revoked",
      actorType: "user",
      actorId: context.userId,
      targetType: "integration_client",
      targetId: client.id,
      details: { name: client.name },
    });
    await transaction.query("commit");
    return client;
  } catch (error) {
    await transaction.query("rollback").catch(() => {});
    throw error;
  } finally {
    transaction.release();
  }
}

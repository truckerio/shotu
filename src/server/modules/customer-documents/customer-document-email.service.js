import { createHash } from "node:crypto";
import { z } from "zod";
import { AuthError, resourceNotFound } from "../../auth/errors.js";
import { requireCompanyAccess, requireLocationAccess, requirePermission } from "../../auth/authorize.js";
import { PERMISSION } from "../../auth/permissions.js";
import { resolveAuthConfig } from "../../auth/config.js";
import { getPool } from "../../db/pool.js";
import { createSmtpMailer } from "../../email/smtp.js";

const inputSchema = z.object({
  companyId: z.string().uuid(),
  locationId: z.string().uuid(),
  rawToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  recipientEmail: z.string().trim().email().max(320).nullable().optional(),
  idempotencyKey: z.string().trim().min(8).max(120),
}).strict();

export async function emailCustomerDocumentLink(context, grantId, rawInput, dependencies = {}) {
  const input = inputSchema.parse(rawInput);
  requirePermission(context, PERMISSION.CUSTOMER_DOCUMENT_WRITE);
  requireCompanyAccess(context, input.companyId);
  requireLocationAccess(context, input.locationId);
  const actorId = context.actor.id;
  const tokenHash = createHash("sha256").update(input.rawToken).digest("hex");
  const pool = dependencies.pool || getPool();
  const client = await pool.connect();
  let delivery;
  let replayed = false;
  const deliveryLock = `customer-document-email:${input.companyId}:${actorId}:${input.idempotencyKey}`;
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [deliveryLock]);
    await client.query("begin");
    const grant = (await client.query(
      `select grant_row.*,revision.recipient_snapshot,document.document_number
         from customer_document_access_grants grant_row
         join customer_document_revisions revision
           on revision.company_id=grant_row.company_id and revision.id=grant_row.revision_id
         join customer_documents document
           on document.company_id=grant_row.company_id and document.id=grant_row.document_id
        where grant_row.company_id=$1 and grant_row.location_id=$2 and grant_row.id=$3
          and grant_row.token_hash=$4 and grant_row.revoked_at is null and grant_row.expires_at>now()
          and 'view_revision'=any(grant_row.allowed_actions)
        for share of grant_row`,
      [input.companyId, input.locationId, grantId, tokenHash],
    )).rows[0];
    if (!grant) throw resourceNotFound("Customer link");
    const recipientEmail = input.recipientEmail || grant.recipient_snapshot?.email || null;
    if (!recipientEmail) {
      await client.query("commit");
      return { status: "missing_email", providerAccepted: false, deliveryId: null, replayed: false };
    }
    const requestHash = createHash("sha256").update(JSON.stringify({
      companyId: input.companyId, locationId: input.locationId, grantId, tokenHash,
      recipientEmail, actorId, idempotencyKey: input.idempotencyKey,
    })).digest("hex");
    delivery = (await client.query(
      `insert into customer_document_email_deliveries(company_id,location_id,document_id,revision_id,
        grant_id,requested_by_user_id,recipient_email,status,idempotency_key,request_hash)
       values($1,$2,$3,$4,$5,$6,$7,'requested',$8,$9)
       on conflict(company_id,requested_by_user_id,idempotency_key) do nothing returning *`,
      [input.companyId, input.locationId, grant.document_id, grant.revision_id, grantId,
        actorId, recipientEmail, input.idempotencyKey, requestHash],
    )).rows[0];
    if (!delivery) {
      delivery = (await client.query(
        `select * from customer_document_email_deliveries
          where company_id=$1 and requested_by_user_id=$2 and idempotency_key=$3`,
        [input.companyId, actorId, input.idempotencyKey],
      )).rows[0];
      if (delivery?.request_hash !== requestHash) {
        throw new AuthError(409, "CUSTOMER_DOCUMENT_DELIVERY_CONFLICT", "This email request key was already used.");
      }
      replayed = true;
    } else {
      await client.query(
        `insert into customer_document_email_delivery_events(company_id,delivery_id,status)
         values($1,$2,'requested')`,
        [input.companyId, delivery.id],
      );
    }
    await client.query("commit");
    if (replayed && delivery.status !== "requested") {
      return { status: delivery.status, providerAccepted: delivery.status === "provider_accepted",
        deliveryId: delivery.id, replayed: true };
    }
    const mailer = dependencies.mailer || createSmtpMailer();
    let status = "not_configured";
    if (mailer.enabled) {
      const origin = new URL((dependencies.baseURL || resolveAuthConfig().baseURL)).origin;
      const link = `${origin}/#customerDocument=${input.rawToken}`;
      try {
        const result = await mailer.send({
          to: recipientEmail,
          subject: `Your repair Estimate ${grant.document_number}`,
          text: `View your repair Estimate using this secure link:\n${link}\n\nThis link expires at ${new Date(grant.expires_at).toISOString()}.`,
        });
        status = Array.isArray(result?.accepted)
          && result.accepted.some((value) => String(value).trim().toLowerCase() === recipientEmail.toLowerCase())
          ? "provider_accepted" : "failed";
      } catch {
        status = "failed";
      }
    }
    await client.query("begin");
    await client.query(
      `update customer_document_email_deliveries set status=$3,resolved_at=now()
       where company_id=$1 and id=$2 and status='requested'`,
      [input.companyId, delivery.id, status],
    );
    await client.query(
      `insert into customer_document_email_delivery_events(company_id,delivery_id,status)
       values($1,$2,$3) on conflict(delivery_id,status) do nothing`,
      [input.companyId, delivery.id, status],
    );
    await client.query("commit");
    return { status, providerAccepted: status === "provider_accepted", deliveryId: delivery.id, replayed };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.query("select pg_advisory_unlock(hashtext($1))", [deliveryLock]).catch(() => {});
    client.release();
  }
}

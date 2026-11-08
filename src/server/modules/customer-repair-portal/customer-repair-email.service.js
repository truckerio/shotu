import { getPool } from "../../db/pool.js";
import { createSmtpMailer } from "../../email/smtp.js";
import { resolveAuthConfig } from "../../auth/config.js";
import { AuthError, resourceNotFound } from "../../auth/errors.js";
import { repairHash } from "../../db/repositories/customer-repair-portal.repo.js";
// A requested record is durable before SMTP. On uncertain transport/crash the
// same key is never resent: SMTP has no transactional exactly-once primitive.
export async function emailRepairLink(input, deps = {}) {
  const client = await (deps.pool || getPool()).connect();
  const lock = `repair-email:${input.companyId}:${input.actorId}:${input.idempotencyKey}`;
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [lock]);
    await client.query("begin");
    const grant = (
      await client.query(
        `select * from customer_repair_access_grants where company_id=$1 and location_id=$2 and workorder_id=$3 and id=$4 and token_hash=$5 and revoked_at is null and expires_at>now() for share`,
        [
          input.companyId,
          input.locationId,
          input.workorderId,
          input.grantId,
          repairHash(input.rawToken),
        ],
      )
    ).rows[0];
    if (!grant) throw resourceNotFound("Customer repair link");
    const requestHash = repairHash({
      grantId: input.grantId,
      tokenHash: repairHash(input.rawToken),
      recipientEmail: input.recipientEmail.toLowerCase(),
      workorderId: input.workorderId,
    });
    const prior = (
      await client.query(
        "select * from customer_repair_email_deliveries where company_id=$1 and requested_by_user_id=$2 and idempotency_key=$3",
        [input.companyId, input.actorId, input.idempotencyKey],
      )
    ).rows[0];
    if (prior) {
      if (prior.request_hash !== requestHash)
        throw new AuthError(
          409,
          "CUSTOMER_REPAIR_CONFLICT",
          "This email request key was already used.",
        );
      await client.query("commit");
      return {
        status: prior.status,
        providerAccepted: prior.status === "provider_accepted",
        deliveryId: prior.id,
        replayed: true,
      };
    }
    const delivery = (
      await client.query(
        `insert into customer_repair_email_deliveries(company_id,grant_id,requested_by_user_id,recipient_email,status,idempotency_key,request_hash) values($1,$2,$3,$4,'requested',$5,$6) returning *`,
        [
          input.companyId,
          input.grantId,
          input.actorId,
          input.recipientEmail,
          input.idempotencyKey,
          requestHash,
        ],
      )
    ).rows[0];
    await client.query(
      `insert into customer_repair_email_events(delivery_id,status) values($1,'requested')`,
      [delivery.id],
    );
    await client.query("commit");
    const mailer = deps.mailer || createSmtpMailer();
    let status = "not_configured";
    if (mailer.enabled) {
      try {
        const origin = new URL(deps.baseURL || resolveAuthConfig().baseURL)
          .origin;
        const result = await mailer.send({
          to: input.recipientEmail,
          subject: "Your vehicle repair",
          text: `View your repair status, Estimate and messages:\n${origin}/#customerRepair=${input.rawToken}\n\nThis secure link expires at ${new Date(grant.expires_at).toISOString()}.`,
        });
        status =
          Array.isArray(result?.accepted) &&
          result.accepted.some(
            (address) =>
              String(address).trim().toLowerCase() ===
              input.recipientEmail.toLowerCase(),
          )
            ? "provider_accepted"
            : "failed";
      } catch {
        // SMTP may have accepted before the connection failed. Replaying this
        // durable request must report unknown rather than send a duplicate.
        status = "requested";
      }
    }
    await client.query("begin");
    await client.query(
      "update customer_repair_email_deliveries set status=$2::varchar,resolved_at=case when $2::varchar='requested' then null else now() end where id=$1",
      [delivery.id, status],
    );
    await client.query(
      "insert into customer_repair_email_events(delivery_id,status) values($1,$2) on conflict(delivery_id,status) do nothing",
      [delivery.id, status],
    );
    await client.query("commit");
    return {
      status,
      providerAccepted: status === "provider_accepted",
      deliveryId: delivery.id,
      replayed: false,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client
      .query("select pg_advisory_unlock(hashtext($1))", [lock])
      .catch(() => {});
    client.release();
  }
}

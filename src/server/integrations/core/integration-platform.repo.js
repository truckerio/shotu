import { getPool, query } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";

export async function enqueueIntegrationJob({
  companyId,
  integrationAccountId = null,
  provider,
  jobType,
  payload = {},
  idempotencyKey = null,
  requestId = null,
  maxAttempts = 5,
  availableAt = null,
}) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `insert into integration_jobs (
       company_id, integration_account_id, provider, job_type, payload,
       idempotency_key, request_id, max_attempts, available_at
     ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, coalesce($9, now()))
     on conflict (company_id, provider, idempotency_key)
       where idempotency_key is not null
     do update set updated_at = integration_jobs.updated_at
     returning *`,
    [
      tenantId,
      integrationAccountId,
      provider,
      jobType,
      JSON.stringify(payload),
      idempotencyKey,
      requestId,
      maxAttempts,
      availableAt,
    ],
  );
  return result.rows[0];
}

export async function claimNextIntegrationJob(workerId, { leaseMinutes = 5 } = {}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `with candidate as (
         select id
         from integration_jobs
         where (
           status in ('queued', 'retry') and available_at <= now()
         ) or (
           status = 'running' and heartbeat_at < now() - ($2::text || ' minutes')::interval
         )
         order by available_at, created_at
         for update skip locked
         limit 1
       )
       update integration_jobs job
       set status = 'running',
           attempts = job.attempts + 1,
           locked_at = now(),
           locked_by = $1,
           heartbeat_at = now(),
           updated_at = now()
       from candidate
       where job.id = candidate.id
       returning job.*`,
      [workerId, leaseMinutes],
    );
    const job = result.rows[0] || null;
    if (job) {
      await client.query(
        `insert into integration_job_attempts (job_id, attempt, worker_id, status)
         values ($1, $2, $3, 'running')
         on conflict (job_id, attempt) do update
         set worker_id = excluded.worker_id, status = 'running', started_at = now(),
             finished_at = null, error_code = null, error_message = null`,
        [job.id, job.attempts, workerId],
      );
    }
    await client.query("commit");
    return job;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function completeIntegrationJob(jobId, attempt) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update integration_jobs
       set status = 'completed', completed_at = now(), locked_at = null,
           locked_by = null, heartbeat_at = null, last_error_code = null,
           last_error_message = null, updated_at = now()
       where id = $1
       returning *`,
      [jobId],
    );
    await client.query(
      `update integration_job_attempts
       set status = 'completed', finished_at = now()
       where job_id = $1 and attempt = $2`,
      [jobId, attempt],
    );
    await client.query("commit");
    return result.rows[0] || null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function failIntegrationJob(job, error, { retryDelaySeconds }) {
  const terminal = Number(job.attempts) >= Number(job.max_attempts);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `update integration_jobs
       set status = $2,
           available_at = case when $2 = 'retry' then now() + ($3::text || ' seconds')::interval else available_at end,
           locked_at = null,
           locked_by = null,
           heartbeat_at = null,
           last_error_code = $4,
           last_error_message = $5,
           updated_at = now()
       where id = $1
       returning *`,
      [
        job.id,
        terminal ? "dead_letter" : "retry",
        retryDelaySeconds,
        error.code || "integration_job_failed",
        String(error.message || "Integration job failed.").slice(0, 2000),
      ],
    );
    await client.query(
      `update integration_job_attempts
       set status = 'failed', finished_at = now(), error_code = $3, error_message = $4
       where job_id = $1 and attempt = $2`,
      [
        job.id,
        job.attempts,
        error.code || "integration_job_failed",
        String(error.message || "Integration job failed.").slice(0, 2000),
      ],
    );
    await client.query("commit");
    return result.rows[0] || null;
  } catch (failure) {
    await client.query("rollback").catch(() => {});
    throw failure;
  } finally {
    client.release();
  }
}

export async function upsertIntegrationMapping({
  client = null,
  companyId,
  provider,
  entityType,
  internalId,
  externalId,
  status = "active",
  metadata = {},
  reconciled = true,
}) {
  const tenantId = requireCompanyId(companyId);
  const runner = client || { query };
  const result = await runner.query(
    `insert into integration_mappings (
       company_id, provider, entity_type, internal_id, external_id, status,
       metadata, last_reconciled_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, case when $8 then now() else null end, now())
     on conflict (company_id, provider, entity_type, internal_id) do update
     set external_id = excluded.external_id,
         status = excluded.status,
         metadata = excluded.metadata,
         last_reconciled_at = case when $8 then now() else integration_mappings.last_reconciled_at end,
         updated_at = now()
     returning *`,
    [
      tenantId,
      provider,
      entityType,
      internalId,
      externalId,
      status,
      JSON.stringify(metadata),
      reconciled,
    ],
  );
  return result.rows[0];
}

export async function appendIntegrationAudit({
  client = null,
  companyId,
  provider = null,
  action,
  actorType,
  actorId = null,
  integrationClientId = null,
  targetType = null,
  targetId = null,
  requestId = null,
  details = {},
}) {
  const tenantId = requireCompanyId(companyId);
  const runner = client || { query };
  const result = await runner.query(
    `insert into integration_audit_events (
       company_id, provider, action, actor_type, actor_id, integration_client_id,
       target_type, target_id, request_id, details
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     returning *`,
    [
      tenantId,
      provider,
      action,
      actorType,
      actorId,
      integrationClientId,
      targetType,
      targetId,
      requestId,
      JSON.stringify(details),
    ],
  );
  return result.rows[0];
}

export async function appendOutboxEvent({
  client = null,
  companyId,
  aggregateType,
  aggregateId,
  eventType,
  payload = {},
  requestId = null,
}) {
  const tenantId = requireCompanyId(companyId);
  const runner = client || { query };
  const result = await runner.query(
    `insert into integration_outbox_events (
       company_id, aggregate_type, aggregate_id, event_type, payload, request_id
     ) values ($1, $2, $3, $4, $5::jsonb, $6)
     returning *`,
    [tenantId, aggregateType, aggregateId, eventType, JSON.stringify(payload), requestId],
  );
  return result.rows[0];
}

export async function recordWebhookReceipt({
  companyId = null,
  provider,
  providerEventId = null,
  signatureDigest = null,
  headers = {},
  payload = {},
  status = "verified",
}) {
  const result = await query(
    `insert into integration_webhook_inbox (
       company_id, provider, provider_event_id, signature_digest, headers, payload, status
     ) values ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
     on conflict (provider, provider_event_id)
       where provider_event_id is not null
     do update set updated_at = integration_webhook_inbox.updated_at
     returning *`,
    [
      companyId,
      provider,
      providerEventId,
      signatureDigest,
      JSON.stringify(headers),
      JSON.stringify(payload),
      status,
    ],
  );
  return result.rows[0];
}

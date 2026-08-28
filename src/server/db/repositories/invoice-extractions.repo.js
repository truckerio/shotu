import { getPool, query } from "../pool.js";
import { InvoiceExtractionError, invoiceConflict } from "../../modules/invoice-extraction/invoice-extraction.errors.js";

export function publicInvoiceExtractionRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    locationId: row.location_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    status: row.status,
    version: Number(row.version),
    draft: row.reviewed_draft || row.extracted_draft || null,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    errorCode: row.error_code || null,
    retryable: row.retryable === true,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    sourceAvailable: Boolean(row.source_document_id) && row.source_training_status !== "deleted",
    trainingStatus: row.source_training_status || null,
    inventoryReceipt: row.local_receipt_id ? {
      id: row.local_receipt_id,
      status: row.local_receipt_status,
      locationId: row.location_id,
      locationName: row.local_receipt_location_name || "",
      lineCount: Number(row.local_receipt_line_count),
      totalQuantity: Number(row.local_receipt_total_quantity),
      postedAt: row.local_receipt_posted_at,
      reversedAt: row.local_receipt_reversed_at || null,
      physicalConfirmation: row.local_receipt_physical_confirmation,
      reviewedRunVersion: Number(row.local_receipt_reviewed_run_version),
      labelBatch: row.label_batch_id ? {
        id: row.label_batch_id,
        receiptId: row.local_receipt_id,
        locationId: row.location_id,
        locationName: row.local_receipt_location_name || "",
        status: row.label_batch_status,
        templateVersion: row.label_batch_template_version,
        itemCount: Number(row.label_batch_item_count),
        createdAt: row.label_batch_created_at,
        manifestUrl: `/api/office/inventory/label-batches/${encodeURIComponent(row.label_batch_id)}/items`,
        printUrl: `/api/office/inventory/label-batches/${encodeURIComponent(row.label_batch_id)}/print`,
      } : null,
    } : null,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
  };
}

async function selectRunWithSource(client, whereSql, parameters) {
  const result = await client.query(
    `select r.*,
            s.id as source_document_id,
            s.training_status as source_training_status,
            s.retention_until as source_retention_until,
            local_receipt.id as local_receipt_id,
            local_receipt.status as local_receipt_status,
            local_receipt.line_count as local_receipt_line_count,
            local_receipt.total_quantity as local_receipt_total_quantity,
            local_receipt.posted_at as local_receipt_posted_at,
            local_receipt.reversed_at as local_receipt_reversed_at,
            local_receipt.physical_confirmation as local_receipt_physical_confirmation,
            local_receipt.reviewed_run_version as local_receipt_reviewed_run_version,
            label_batch.id as label_batch_id,
            label_batch.status as label_batch_status,
            label_batch.template_version as label_batch_template_version,
            label_batch.item_count as label_batch_item_count,
            label_batch.created_at as label_batch_created_at,
            local_receipt_location.name as local_receipt_location_name
     from invoice_extraction_runs r
     left join invoice_source_documents s
       on s.company_id = r.company_id and s.run_id = r.id
     left join local_inventory_receipts local_receipt
       on local_receipt.company_id = r.company_id and local_receipt.invoice_run_id = r.id
     left join locations local_receipt_location
       on local_receipt_location.company_id = local_receipt.company_id
      and local_receipt_location.id = local_receipt.location_id
     left join inventory_label_batches label_batch
       on label_batch.company_id = local_receipt.company_id
      and label_batch.receipt_id = local_receipt.id
     where ${whereSql}
     limit 1`,
    parameters,
  );
  return result.rows[0] || null;
}

export async function loadInvoiceExtractionMemory({ companyId, vendorKey = "", factLimit = 20, playbookLimit = 5, exampleLimit = 3 }) {
  const [facts, playbooks, trainingExamples] = await Promise.all([
    query(
      `select id, fact_type, fact_key, fact_value, version
       from invoice_semantic_facts
       where company_id = $1
         and status = 'approved'
         and (vendor_key = '' or ($2 <> '' and vendor_key = $2))
       order by (vendor_key = $2 and $2 <> '') desc, updated_at desc, id
       limit $3`,
      [companyId, vendorKey, Math.min(20, Math.max(0, factLimit))],
    ),
    query(
      `select id, name, rule_text, version
       from invoice_extraction_playbooks
       where company_id = $1
         and status = 'active'
         and (vendor_key = '' or ($2 <> '' and vendor_key = $2))
       order by (vendor_key = $2 and $2 <> '') desc, version desc, id
       limit $3`,
      [companyId, vendorKey, Math.min(5, Math.max(0, playbookLimit))],
    ),
    query(
      `select t.id, t.vendor_key, t.label_version,
              coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'fieldPath', c.field_path,
                    'predictedValue', c.predicted_value,
                    'reviewedValue', c.reviewed_value,
                    'correctionType', c.correction_type
                  ) order by c.created_at, c.id
                ) filter (where c.id is not null),
                '[]'::jsonb
              ) as corrections
       from invoice_training_examples t
       left join invoice_correction_events c
         on c.company_id = t.company_id and c.run_id = t.run_id
       where t.company_id = $1
         and t.status = 'eligible'
         and $2 <> ''
         and t.vendor_key = $2
       group by t.id, t.vendor_key, t.label_version, t.created_at
       having count(c.id) > 0
       order by t.created_at desc, t.id
       limit $3`,
      [companyId, vendorKey, Math.min(5, Math.max(0, exampleLimit))],
    ),
  ]);
  return { semanticFacts: facts.rows, playbooks: playbooks.rows, trainingExamples: trainingExamples.rows };
}

export async function loadInvoiceLayoutTemplates({ companyId, vendorKey = "", statuses = ["active"], limit = 25 }) {
  const allowedStatuses = statuses.filter((status) => ["candidate", "active", "quarantined", "retired"].includes(status));
  if (!allowedStatuses.length) return [];
  const result = await query(
    `select id, company_id, vendor_key, fingerprint, template_payload, status,
            evidence_count, contradiction_count, version, updated_at
     from invoice_layout_templates
     where company_id = $1
       and status = any($2::varchar[])
       and ($3 = '' or vendor_key = $3)
     order by (vendor_key = $3 and $3 <> '') desc, status = 'active' desc,
              evidence_count desc, updated_at desc, id
     limit $4`,
    [companyId, allowedStatuses, vendorKey, Math.min(50, Math.max(1, Number(limit) || 25))],
  );
  return result.rows;
}

export async function createInvoiceExtractionRun(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `insert into invoice_extraction_runs (
         id, company_id, location_id, created_by, document_hash, file_name, mime_type,
         byte_size, idempotency_key, status, provider, model, prompt_version, memory_snapshot
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'processing', $10, $11, $12, $13)
       on conflict (company_id, created_by, idempotency_key) do nothing
       returning id`,
      [
        input.runId, input.companyId, input.locationId, input.actorId, input.documentHash, input.fileName,
        input.mimeType, input.byteSize, input.idempotencyKey, input.provider, input.model,
        input.promptVersion, JSON.stringify(input.memorySnapshot || {}),
      ],
    );
    if (result.rows[0]) {
      await client.query(
        `insert into invoice_source_documents (
           company_id, run_id, ciphertext, iv, auth_tag, key_version, content_sha256,
           mime_type, byte_size, retention_until
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.companyId, input.runId, input.source.ciphertext, input.source.iv, input.source.authTag,
          input.source.keyVersion, input.documentHash, input.mimeType, input.byteSize, input.retentionUntil],
      );
      if (input.enqueueJob) {
        await client.query(
          `insert into integration_jobs (
             company_id, provider, job_type, payload, idempotency_key, max_attempts
           ) values ($1, 'invoice_extraction', 'extract', $2::jsonb, $3, $4)
           on conflict (company_id, provider, idempotency_key)
             where idempotency_key is not null
           do nothing`,
          [
            input.companyId,
            JSON.stringify({ runId: input.runId, vendorHint: String(input.vendorHint || "").slice(0, 180) }),
            `invoice-extraction:${input.runId}`,
            Math.min(5, Math.max(1, Number(input.maxAttempts) || 2)),
          ],
        );
      }
      const created = await selectRunWithSource(client, "r.id = $1 and r.company_id = $2", [input.runId, input.companyId]);
      await client.query("commit");
      return { ...created, inserted: true };
    }
    const existing = await selectRunWithSource(
      client,
      "r.company_id = $1 and r.created_by = $2 and r.idempotency_key = $3",
      [input.companyId, input.actorId, input.idempotencyKey],
    );
    await client.query("commit");
    return existing ? { ...existing, inserted: false } : null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function completeInvoiceExtractionRun({
  runId,
  companyId,
  draft,
  status,
  durationMs,
  providerResponseId,
  usage = {},
  provider = null,
  model = null,
  promptVersion = null,
}) {
  const updated = await query(
    `update invoice_extraction_runs
     set extracted_draft = $3,
         status = $4,
         duration_ms = $5,
         provider_response_id = $6,
         input_tokens = $7,
         output_tokens = $8,
         reasoning_tokens = $9,
         provider = coalesce($10, provider),
         model = coalesce($11, model),
         prompt_version = coalesce($12, prompt_version),
         error_code = null,
         retryable = false
     where id = $1 and company_id = $2 and status = 'processing'
     returning id`,
    [runId, companyId, JSON.stringify(draft), status, durationMs, providerResponseId || null,
      usage.inputTokens ?? null, usage.outputTokens ?? null, usage.reasoningTokens ?? null,
      provider, model, promptVersion],
  );
  if (!updated.rows[0]) return null;
  return selectRunWithSource({ query }, "r.id = $1 and r.company_id = $2", [runId, companyId]);
}

export async function failInvoiceExtractionRun({ runId, companyId, errorCode, retryable, durationMs }) {
  const result = await query(
    `update invoice_extraction_runs
     set status = 'failed', error_code = $3, retryable = $4, duration_ms = $5
     where id = $1 and company_id = $2 and status = 'processing'
     returning *`,
    [runId, companyId, errorCode, retryable, durationMs],
  );
  return result.rows[0] || null;
}

export async function getInvoiceExtractionRun({ runId, companyIds }) {
  return selectRunWithSource({ query }, "r.id = $1 and r.company_id = any($2::uuid[])", [runId, companyIds]);
}

export async function getInvoiceSourceDocument({ runId, companyIds, locationIds = [], isAdmin = false }) {
  const result = await query(
    `select s.*, r.location_id
     from invoice_source_documents s
     join invoice_extraction_runs r on r.company_id = s.company_id and r.id = s.run_id
     where s.run_id = $1 and s.company_id = any($2::uuid[]) and s.training_status <> 'deleted'
       and ($4::boolean or r.location_id = any($3::uuid[]))
     limit 1`,
    [runId, companyIds, locationIds, isAdmin],
  );
  return result.rows[0] || null;
}

export async function getInvoiceExtractionWorkerSource({ runId, companyId }) {
  const result = await query(
    `select s.*, r.location_id, r.file_name, r.status as run_status,
            r.created_by, r.provider, r.model, r.prompt_version
     from invoice_source_documents s
     join invoice_extraction_runs r on r.company_id = s.company_id and r.id = s.run_id
     where s.run_id = $1 and s.company_id = $2
       and s.training_status <> 'deleted' and r.status = 'processing'
     limit 1`,
    [runId, companyId],
  );
  return result.rows[0] || null;
}

export async function recordInvoiceSourceAccess({ source, actorId, action = "view" }) {
  await query(
    `insert into invoice_source_access_events (company_id, run_id, source_document_id, actor_id, action)
     values ($1, $2, $3, $4, $5)`,
    [source.company_id, source.run_id, source.id, actorId, action],
  );
}

export async function deleteExpiredInvoiceSources({ limit = 100, companyId = null } = {}) {
  const boundedLimit = Math.min(1000, Math.max(1, Number(limit) || 100));
  const result = await query(
    `with expired as (
       select id
       from invoice_source_documents
       where retention_until <= now() and training_status <> 'deleted'
         and ($2::uuid is null or company_id = $2)
       order by retention_until, id
       for update skip locked
       limit $1
     ), deleted as (
       update invoice_source_documents s
       set ciphertext = null, iv = null, auth_tag = null,
           training_status = 'deleted', deleted_at = now()
       from expired e
       where s.id = e.id
       returning s.company_id, s.run_id, s.id
     )
     insert into invoice_source_access_events (
       company_id, run_id, source_document_id, actor_id, action
     )
     select company_id, run_id, id, null, 'retention_delete'
     from deleted
     returning id`,
    [boundedLimit, companyId],
  );
  return result.rowCount;
}

export async function reviewInvoiceExtractionRun({
  actorId,
  companyIds,
  runId,
  expectedVersion,
  idempotencyKey,
  reviewedDraft,
  corrections,
  semanticCandidates,
  approveLearning,
  trainingExample,
  layoutTemplateLearning = null,
  requestHash,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select * from invoice_extraction_runs
       where id = $1 and company_id = any($2::uuid[])
       limit 1 for update`,
      [runId, companyIds],
    );
    const run = selected.rows[0] || null;
    if (!run) {
      await client.query("rollback");
      return null;
    }
    if (run.status === "reviewed") {
      if (run.review_idempotency_key === idempotencyKey && run.review_request_hash === requestHash) {
        const replay = await selectRunWithSource(client, "r.id = $1 and r.company_id = $2", [runId, run.company_id]);
        await client.query("commit");
        return replay;
      }
      throw invoiceConflict(Number(run.version));
    }
    if (Number(run.version) !== expectedVersion) throw invoiceConflict(Number(run.version));
    const updated = await client.query(
      `update invoice_extraction_runs
       set reviewed_draft = $3,
           review_idempotency_key = $4,
           review_request_hash = $7,
           reviewed_by = $5,
           reviewed_at = now(),
           status = 'reviewed',
           version = version + 1
       where id = $1 and company_id = $2 and version = $6 and status in ('completed', 'needs_review')
       returning *`,
      [runId, run.company_id, JSON.stringify(reviewedDraft), idempotencyKey, actorId, expectedVersion, requestHash],
    );
    if (!updated.rows[0]) throw invoiceConflict(Number(run.version));

    for (const event of corrections) {
      await client.query(
        `insert into invoice_correction_events (
           company_id, run_id, reviewer_id, field_path, predicted_value, reviewed_value, correction_type
         ) values ($1, $2, $3, $4, $5, $6, $7)`,
        [run.company_id, runId, actorId, event.fieldPath, JSON.stringify(event.predictedValue), JSON.stringify(event.reviewedValue), event.correctionType],
      );
    }
    for (const fact of semanticCandidates) {
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1))",
        [`invoice-fact:${run.company_id}:${fact.vendorKey}:${fact.factType}:${fact.factKey}`],
      );
      const conflicting = await client.query(
        `select count(*)::integer as count
         from invoice_semantic_facts
         where company_id = $1 and vendor_key = $2 and fact_type = $3 and fact_key = $4
           and fact_value_hash <> $5 and status = 'approved'`,
        [run.company_id, fact.vendorKey, fact.factType, fact.factKey, fact.factValueHash],
      );
      await client.query(
        `update invoice_semantic_facts
         set contradiction_count = contradiction_count + 1, updated_at = now(), version = version + 1
         where company_id = $1 and vendor_key = $2 and fact_type = $3 and fact_key = $4
           and fact_value_hash <> $5`,
        [run.company_id, fact.vendorKey, fact.factType, fact.factKey, fact.factValueHash],
      );
      const approveFact = approveLearning && Number(conflicting.rows[0]?.count || 0) === 0;
      await client.query(
        `insert into invoice_semantic_facts (
           company_id, vendor_key, fact_type, fact_key, fact_value, fact_value_hash,
           first_evidence_run_id, last_evidence_run_id, status, approved_by, approved_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $7, $8::varchar, $9::uuid, case when $8::varchar = 'approved' then now() else null end)
         on conflict (company_id, vendor_key, fact_type, fact_key, fact_value_hash)
         do update set evidence_count = invoice_semantic_facts.evidence_count + 1,
                       last_evidence_run_id = excluded.last_evidence_run_id,
                       status = case when invoice_semantic_facts.status in ('approved', 'rejected') then invoice_semantic_facts.status else excluded.status end,
                       approved_by = case when invoice_semantic_facts.status in ('approved', 'rejected') then invoice_semantic_facts.approved_by else excluded.approved_by end,
                       approved_at = case when invoice_semantic_facts.status in ('approved', 'rejected') then invoice_semantic_facts.approved_at else excluded.approved_at end,
                       updated_at = now(),
                       version = invoice_semantic_facts.version + 1`,
        [run.company_id, fact.vendorKey, fact.factType, fact.factKey, JSON.stringify(fact.factValue), fact.factValueHash, runId, approveFact ? "approved" : "candidate", approveFact ? actorId : null],
      );
    }
    const source = await client.query(
      `select id from invoice_source_documents
       where company_id = $1 and run_id = $2 and training_status <> 'deleted'
       limit 1 for update`,
      [run.company_id, runId],
    );
    if (approveLearning && !source.rows[0]) {
      throw new InvoiceExtractionError("The source document is unavailable for learning.", {
        code: "invoice_source_unavailable",
        statusCode: 409,
      });
    }
    if (source.rows[0]) {
      await client.query(
        `update invoice_source_documents
         set training_status = $3
         where company_id = $1 and run_id = $2`,
        [run.company_id, runId, approveLearning ? "eligible" : "excluded"],
      );
      if (approveLearning) {
        await client.query(
          `insert into invoice_training_examples (
             company_id, run_id, source_document_id, predicted_draft, gold_draft,
             quality_metrics, vendor_key, extractor_provider, extractor_model,
             prompt_version, reviewer_id, status, label_version
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'eligible', 1)
           on conflict (company_id, run_id, label_version) do nothing`,
          [run.company_id, runId, source.rows[0].id, JSON.stringify(run.extracted_draft),
            JSON.stringify(reviewedDraft), JSON.stringify(trainingExample.qualityMetrics),
            trainingExample.vendorKey, run.provider, run.model, run.prompt_version, actorId],
        );
      }
    }
    if (approveLearning && layoutTemplateLearning) {
      const vendorKey = String(layoutTemplateLearning.vendorKey || "").slice(0, 180);
      const promotionExamples = Math.max(3, Math.min(10, Number(layoutTemplateLearning.promotionExamples) || 3));
      await client.query(
        "select pg_advisory_xact_lock(hashtext($1))",
        [`invoice-layout:${run.company_id}:${vendorKey}`],
      );
      if (layoutTemplateLearning.matchedTemplateId) {
        const matched = await client.query(
          `select id, evidence_count, status
           from invoice_layout_templates
           where id = $1 and company_id = $2 and vendor_key = $3
             and status in ('candidate', 'active')
           limit 1 for update`,
          [layoutTemplateLearning.matchedTemplateId, run.company_id, vendorKey],
        );
        if (matched.rows[0]) {
          const nextEvidence = Number(matched.rows[0].evidence_count) + 1;
          const activate = matched.rows[0].status === "active" || nextEvidence >= promotionExamples;
          await client.query(
            `update invoice_layout_templates
             set evidence_count = $4,
                 last_evidence_run_id = $5,
                 status = case when $6 then 'active' else status end,
                 activated_by = case when $6 and activated_by is null then $7 else activated_by end,
                 activated_at = case when $6 and activated_at is null then now() else activated_at end,
                 updated_at = now(),
                 version = version + 1
             where id = $1 and company_id = $2 and vendor_key = $3`,
            [matched.rows[0].id, run.company_id, vendorKey, nextEvidence, runId, activate, actorId],
          );
        }
      } else {
        await client.query(
          `insert into invoice_layout_templates (
             company_id, vendor_key, fingerprint, template_payload,
             first_evidence_run_id, last_evidence_run_id, created_by
           ) values ($1, $2, $3, $4, $5, $5, $6)
           on conflict (company_id, vendor_key, fingerprint)
           do update set evidence_count = invoice_layout_templates.evidence_count + 1,
                         last_evidence_run_id = excluded.last_evidence_run_id,
                         status = case
                           when invoice_layout_templates.status = 'candidate'
                            and invoice_layout_templates.evidence_count + 1 >= $7 then 'active'
                           else invoice_layout_templates.status
                         end,
                         activated_by = case
                           when invoice_layout_templates.status = 'candidate'
                            and invoice_layout_templates.evidence_count + 1 >= $7 then $6
                           else invoice_layout_templates.activated_by
                         end,
                         activated_at = case
                           when invoice_layout_templates.status = 'candidate'
                            and invoice_layout_templates.evidence_count + 1 >= $7 then now()
                           else invoice_layout_templates.activated_at
                         end,
                         updated_at = now(),
                         version = invoice_layout_templates.version + 1`,
          [run.company_id, vendorKey, layoutTemplateLearning.candidate.fingerprint,
            JSON.stringify(layoutTemplateLearning.candidate), runId, actorId, promotionExamples],
        );
      }
    }
    await client.query("commit");
    return selectRunWithSource({ query: (sql, params) => client.query(sql, params) }, "r.id = $1 and r.company_id = $2", [runId, run.company_id]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

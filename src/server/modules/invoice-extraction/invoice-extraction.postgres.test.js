import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  completeInvoiceExtractionRun,
  createInvoiceExtractionRun,
  deleteExpiredInvoiceSources,
  getInvoiceExtractionRun,
  getInvoiceSourceDocument,
  loadInvoiceExtractionMemory,
  loadInvoiceLayoutTemplates,
  reviewInvoiceExtractionRun,
} from "../../db/repositories/invoice-extractions.repo.js";
import { closePool, query } from "../../db/pool.js";
import { encryptInvoiceDocument } from "./invoice-document.crypto.js";
import { claimNextIntegrationJob } from "../../integrations/core/integration-platform.repo.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";

after(async () => {
  if (runPostgres) await closePool();
});

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("real PostgreSQL serializes reviews, preserves replay idempotency, and hides cross-tenant runs", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const actorId = randomUUID();
  const companyA = randomUUID();
  const companyB = randomUUID();
  const locationA = randomUUID();
  const locationB = randomUUID();
  let runId;
  const additionalRunIds = [];

  try {
    await query("insert into user_profiles (id, display_name) values ($1, $2)", [actorId, `Invoice integration ${suffix}`]);
    await query(
      "insert into companies (id, slug, name) values ($1, $2, $3), ($4, $5, $6)",
      [companyA, `invoice-a-${suffix}`, "Invoice tenant A", companyB, `invoice-b-${suffix}`, "Invoice tenant B"],
    );
    await query(
      "insert into locations (id, company_id, name) values ($1, $2, $3), ($4, $5, $6)",
      [locationA, companyA, `Invoice shop A ${suffix}`, locationB, companyB, `Invoice shop B ${suffix}`],
    );

    const requestedRunId = randomUUID();
    const sourceBytes = Buffer.from(`postgres-invoice-secret-${suffix}`);
    const documentHash = sha256(sourceBytes);
    const encryptedSource = encryptInvoiceDocument(sourceBytes, {
      companyId: companyA, runId: requestedRunId, documentHash, mimeType: "application/pdf",
    }, { key: Buffer.alloc(32, 8).toString("base64"), keyVersion: "test-v1", iv: Buffer.alloc(12, 6) });
    const created = await createInvoiceExtractionRun({
      runId: requestedRunId,
      companyId: companyA,
      locationId: locationA,
      actorId,
      documentHash,
      fileName: "integration-invoice.pdf",
      mimeType: "application/pdf",
      byteSize: sourceBytes.length,
      idempotencyKey: `extract-${suffix}`,
      provider: "openai",
      model: "integration-test",
      promptVersion: "invoice-v1",
      memorySnapshot: {},
      vendorHint: "FleetPride",
      enqueueJob: true,
      maxAttempts: 2,
      source: encryptedSource,
      retentionUntil: new Date(Date.now() + 86_400_000).toISOString(),
    });
    runId = created.id;
    const queuedJob = await query(
      `select id, company_id, provider, job_type, status, payload, max_attempts
       from integration_jobs
       where company_id = $1 and provider = 'invoice_extraction'
         and idempotency_key = $2`,
      [companyA, `invoice-extraction:${runId}`],
    );
    assert.equal(queuedJob.rows.length, 1);
    assert.equal(queuedJob.rows[0].company_id, companyA);
    assert.equal(queuedJob.rows[0].job_type, "extract");
    assert.equal(queuedJob.rows[0].status, "queued");
    assert.equal(queuedJob.rows[0].payload.runId, runId);
    assert.equal(queuedJob.rows[0].payload.vendorHint, "FleetPride");
    assert.equal(Number(queuedJob.rows[0].max_attempts), 2);
    assert.equal(await claimNextIntegrationJob(`test-worker-${suffix}`, {
      includeProviders: ["samsara"],
    }), null);
    const claimedJob = await claimNextIntegrationJob(`test-worker-${suffix}`, {
      includeProviders: ["invoice_extraction"],
    });
    assert.equal(claimedJob.id, queuedJob.rows[0].id);
    assert.equal(claimedJob.locked_by, `test-worker-${suffix}`);
    const storedSource = await query(
      "select ciphertext from invoice_source_documents where company_id = $1 and run_id = $2",
      [companyA, runId],
    );
    assert.equal(storedSource.rows[0].ciphertext.equals(sourceBytes), false);
    assert.equal(await getInvoiceSourceDocument({
      runId, companyIds: [companyA], locationIds: [locationB], isAdmin: false,
    }), null);
    assert.ok(await getInvoiceSourceDocument({
      runId, companyIds: [companyA], locationIds: [], isAdmin: true,
    }));
    await completeInvoiceExtractionRun({
      runId,
      companyId: companyA,
      draft: { vendorName: { value: "Fleet Pride" }, lines: [] },
      status: "completed",
      durationMs: 1,
    });

    assert.equal(await getInvoiceExtractionRun({ runId, companyIds: [companyB] }), null);

    const correction = {
      fieldPath: "vendorName.value",
      predictedValue: "Fleet Pride",
      reviewedValue: "FleetPride",
      correctionType: "changed",
    };
    const fact = {
      vendorKey: "fleetpride",
      factType: "vendor_alias",
      factKey: "fleet pride",
      factValue: "FleetPride",
      factValueHash: sha256(JSON.stringify("FleetPride")),
    };
    const layoutCandidate = {
      schemaVersion: 1,
      signatureMarkers: [sha256("marker-a"), sha256("marker-b"), sha256("marker-c")],
      signatureRegions: [
        { digest: sha256("marker-a"), centerX: 0.1, centerY: 0.1 },
        { digest: sha256("marker-b"), centerX: 0.2, centerY: 0.2 },
        { digest: sha256("marker-c"), centerX: 0.3, centerY: 0.3 },
      ],
      fieldAnchors: [], tableColumns: [], tableBounds: null,
      staticFields: { documentType: "invoice", currency: "USD" },
      learningMetrics: { eligibleRegionCount: 3, anchoredFieldCount: 0, tableColumnCount: 0 },
    };
    layoutCandidate.fingerprint = sha256(JSON.stringify(layoutCandidate));
    const commands = ["review-a", "review-b"].map((label) => ({
      actorId,
      companyIds: [companyA],
      runId,
      expectedVersion: 1,
      idempotencyKey: `${label}-${suffix}`,
      reviewedDraft: { vendorName: { value: "FleetPride" }, lines: [] },
      corrections: [correction],
      semanticCandidates: [fact],
      approveLearning: true,
      trainingExample: { vendorKey: "fleetpride", qualityMetrics: { correctionCount: 1, totalsReconcile: true } },
      layoutTemplateLearning: {
        vendorKey: "fleetpride",
        candidate: layoutCandidate,
        matchedTemplateId: null,
        promotionExamples: 3,
      },
      requestHash: sha256(`${label}-${suffix}`),
    }));
    const results = await Promise.allSettled(commands.map((command) => reviewInvoiceExtractionRun(command)));
    const successes = results.flatMap((result, index) => result.status === "fulfilled" ? [{ result, index }] : []);
    const conflicts = results.filter((result) => result.status === "rejected");
    assert.equal(successes.length, 1, results.map((result) => result.status === "rejected"
      ? `${result.reason.code || "error"}:${result.reason.message}`
      : "fulfilled").join(" | "));
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].reason.code, "invoice_extraction_conflict");

    const winningCommand = commands[successes[0].index];
    const replay = await reviewInvoiceExtractionRun(winningCommand);
    assert.equal(replay.version, 2);
    const counts = await query(
      `select
         (select count(*)::integer from invoice_correction_events where company_id = $1 and run_id = $2) as corrections,
         (select count(*)::integer from invoice_semantic_facts where company_id = $1 and first_evidence_run_id = $2 and status = 'approved') as approved_facts,
         (select count(*)::integer from invoice_training_examples where company_id = $1 and run_id = $2 and status = 'eligible') as training_examples,
         (select count(*)::integer from invoice_layout_templates where company_id = $1 and first_evidence_run_id = $2 and status = 'candidate') as layout_templates`,
      [companyA, runId],
    );
    assert.deepEqual(counts.rows[0], { corrections: 1, approved_facts: 1, training_examples: 1, layout_templates: 1 });
    const learnedMemory = await loadInvoiceExtractionMemory({ companyId: companyA, vendorKey: "fleetpride" });
    assert.equal(learnedMemory.trainingExamples.length, 1);
    assert.equal(learnedMemory.trainingExamples[0].corrections[0].fieldPath, "vendorName.value");
    assert.equal(learnedMemory.trainingExamples[0].corrections[0].reviewedValue, "FleetPride");
    await query(
      `insert into invoice_training_examples (
         company_id, run_id, source_document_id, predicted_draft, gold_draft,
         quality_metrics, vendor_key, extractor_provider, extractor_model,
         prompt_version, reviewer_id, status, label_version
       )
       select $1, $2, s.id, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $3,
              'integration-test', 'integration-test', 'invoice-v1', $4, 'eligible', $5
       from invoice_source_documents s
       where s.company_id = $1 and s.run_id = $2`,
      [companyA, runId, "", actorId, 2],
    );
    await query(
      `insert into invoice_training_examples (
         company_id, run_id, source_document_id, predicted_draft, gold_draft,
         quality_metrics, vendor_key, extractor_provider, extractor_model,
         prompt_version, reviewer_id, status, label_version
       )
       select $1, $2, s.id, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, $3,
              'integration-test', 'integration-test', 'invoice-v1', $4, 'eligible', $5
       from invoice_source_documents s
       where s.company_id = $1 and s.run_id = $2`,
      [companyA, runId, "other-vendor", actorId, 3],
    );
    assert.equal((await loadInvoiceExtractionMemory({ companyId: companyA, vendorKey: "" })).trainingExamples.length, 0);
    assert.equal((await loadInvoiceExtractionMemory({ companyId: companyA, vendorKey: "fleetpride" })).trainingExamples.length, 1);
    assert.equal((await loadInvoiceExtractionMemory({ companyId: companyA, vendorKey: "other-vendor" })).trainingExamples.length, 1);
    assert.equal((await loadInvoiceExtractionMemory({ companyId: companyA, vendorKey: "unmatched-vendor" })).trainingExamples.length, 0);
    assert.equal((await loadInvoiceExtractionMemory({ companyId: companyB, vendorKey: "fleetpride" })).trainingExamples.length, 0);
    const candidateTemplates = await loadInvoiceLayoutTemplates({ companyId: companyA, vendorKey: "fleetpride", statuses: ["candidate"] });
    assert.equal(candidateTemplates.length, 1);
    assert.equal((await loadInvoiceLayoutTemplates({ companyId: companyB, vendorKey: "fleetpride", statuses: ["candidate"] })).length, 0);

    for (const index of [2, 3]) {
      const nextRunId = randomUUID();
      additionalRunIds.push(nextRunId);
      const nextSource = Buffer.from(`postgres-invoice-template-${index}-${suffix}`);
      const nextHash = sha256(nextSource);
      const nextEncrypted = encryptInvoiceDocument(nextSource, {
        companyId: companyA, runId: nextRunId, documentHash: nextHash, mimeType: "application/pdf",
      }, { key: Buffer.alloc(32, 8).toString("base64"), keyVersion: "test-v1", iv: Buffer.alloc(12, index + 6) });
      await createInvoiceExtractionRun({
        runId: nextRunId, companyId: companyA, locationId: locationA, actorId,
        documentHash: nextHash, fileName: `integration-invoice-${index}.pdf`, mimeType: "application/pdf",
        byteSize: nextSource.length, idempotencyKey: `extract-${index}-${suffix}`,
        provider: "openai", model: "integration-test", promptVersion: "invoice-v1",
        memorySnapshot: {}, source: nextEncrypted,
        retentionUntil: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await completeInvoiceExtractionRun({
        runId: nextRunId, companyId: companyA,
        draft: { vendorName: { value: "FleetPride" }, lines: [] }, status: "completed", durationMs: 1,
      });
      await reviewInvoiceExtractionRun({
        actorId, companyIds: [companyA], runId: nextRunId, expectedVersion: 1,
        idempotencyKey: `review-${index}-${suffix}`,
        reviewedDraft: { vendorName: { value: "FleetPride" }, lines: [] },
        corrections: [], semanticCandidates: [], approveLearning: true,
        trainingExample: { vendorKey: "fleetpride", qualityMetrics: { correctionCount: 0, totalsReconcile: true } },
        layoutTemplateLearning: {
          vendorKey: "fleetpride", candidate: layoutCandidate,
          matchedTemplateId: candidateTemplates[0].id, promotionExamples: 3,
        },
        requestHash: sha256(`review-${index}-${suffix}`),
      });
    }
    const activeTemplates = await loadInvoiceLayoutTemplates({ companyId: companyA, vendorKey: "fleetpride", statuses: ["active"] });
    assert.equal(activeTemplates.length, 1);
    assert.equal(Number(activeTemplates[0].evidence_count), 3);

    await query("update invoice_source_documents set retention_until = now() - interval '1 second' where company_id = $1 and run_id = $2", [companyA, runId]);
    assert.equal(await deleteExpiredInvoiceSources({ companyId: companyA }), 1);
    const retainedLineage = await query(
      `select s.training_status, s.ciphertext is null as payload_erased,
              (select count(*)::integer from invoice_training_examples t where t.company_id = $1 and t.run_id = $2) as examples,
              (select count(*)::integer from invoice_source_access_events e where e.company_id = $1 and e.run_id = $2 and e.action = 'retention_delete') as deletion_events
       from invoice_source_documents s where s.company_id = $1 and s.run_id = $2`,
      [companyA, runId],
    );
    assert.deepEqual(retainedLineage.rows[0], { training_status: "deleted", payload_erased: true, examples: 3, deletion_events: 1 });
  } finally {
    if (additionalRunIds.length) await query("delete from invoice_extraction_runs where id = any($1::uuid[])", [additionalRunIds]).catch(() => {});
    if (runId) await query("delete from invoice_extraction_runs where id = $1", [runId]).catch(() => {});
    await query("delete from locations where id = any($1::uuid[])", [[locationA, locationB]]).catch(() => {});
    await query("delete from companies where id = any($1::uuid[])", [[companyA, companyB]]).catch(() => {});
    await query("delete from user_profiles where id = $1", [actorId]).catch(() => {});
  }
});

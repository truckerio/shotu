import { getPool, query } from "../pool.js";

const LIFECYCLE_STATES = new Set(["shadow", "canary", "active", "quarantined", "retired"]);
const LIFECYCLE_TRANSITIONS = new Map([
  ["shadow", new Set(["canary", "quarantined", "retired"])],
  ["canary", new Set(["active", "quarantined", "retired"])],
  ["active", new Set(["quarantined", "retired"])],
  ["quarantined", new Set(["shadow", "retired"])],
  ["retired", new Set()],
]);

function artifactLockKey(input) {
  return `invoice-global-artifact:${input.structuralFingerprint}:${input.schemaVersion}:${input.hmacKeyVersion}`;
}

export async function lockGlobalLayoutArtifact(input, db) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [artifactLockKey(input)]);
}

export async function lockGlobalLayoutHmacLifecycle(db) {
  await db.query("select pg_advisory_xact_lock(hashtext('invoice-global-hmac-version'))");
}

export async function withGlobalLayoutTransaction(operation, pool = getPool()) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getGlobalLayoutConsent({ companyId }, db = { query }) {
  const result = await db.query(
    `select company_id, state, policy_version, version, changed_at
     from invoice_global_layout_consents where company_id = $1 limit 1`,
    [companyId],
  );
  return result.rows[0] || null;
}

export async function getGlobalLayoutConsentEvent({ companyId, idempotencyKey }, db = { query }) {
  const result = await db.query(
    `select action, policy_version, created_at
     from invoice_global_layout_consent_events
     where company_id = $1 and idempotency_key = $2 limit 1`,
    [companyId, idempotencyKey],
  );
  return result.rows[0] || null;
}

export async function activateGlobalLayoutHmacVersion({ keyVersion }, db = null) {
  if (!/^[a-z0-9_-]{1,40}$/.test(String(keyVersion || ""))) throw new Error("invalid_global_layout_hmac_version");
  if (!db) return withGlobalLayoutTransaction((client) => activateGlobalLayoutHmacVersion({ keyVersion }, client));
  await lockGlobalLayoutHmacLifecycle(db);
  await db.query(
    `update invoice_global_layout_hmac_versions
     set status = 'matching' where status = 'active' and key_version <> $1`,
    [keyVersion],
  );
  const result = await db.query(
    `insert into invoice_global_layout_hmac_versions (key_version, status, activated_at)
     values ($1, 'active', now())
     on conflict (key_version) do update
       set status = 'active', activated_at = now(), retired_at = null
     returning key_version, status, activated_at`,
    [keyVersion],
  );
  return result.rows[0];
}

export async function retireGlobalLayoutHmacVersion({ keyVersion }, db = null) {
  if (!db) return withGlobalLayoutTransaction((client) => retireGlobalLayoutHmacVersion({ keyVersion }, client));
  await lockGlobalLayoutHmacLifecycle(db);
  const result = await db.query(
    `update invoice_global_layout_hmac_versions
     set status = 'retired', retired_at = now()
     where key_version = $1 and status = 'matching'
     returning key_version, status, retired_at`,
    [keyVersion],
  );
  if (result.rows[0]) {
    await db.query(
      `with selected as (
         select id, status from invoice_global_layout_templates
         where hmac_key_version = $1 and status in ('shadow', 'canary', 'active')
         for update
       ), changed as (
         update invoice_global_layout_templates template
         set status = 'quarantined', quarantined_at = coalesce(quarantined_at, now()), updated_at = now()
         from selected where template.id = selected.id returning template.id
       )
       insert into invoice_global_layout_lifecycle_events (
         template_id, from_status, to_status, owner, reason_code
       ) select selected.id, selected.status, 'quarantined', 'hmac_lifecycle', 'hmac_key_retired'
         from selected join changed on changed.id = selected.id`,
      [keyVersion],
    );
  }
  return result.rows[0] || null;
}

export async function enableGlobalLayoutConsent(input, db) {
  const result = await db.query(
    `insert into invoice_global_layout_consents (
       company_id, state, policy_version, changed_by
     ) select $1, 'enabled', $2, $3 where $4 = 0
     on conflict (company_id) do update
       set state = 'enabled', policy_version = excluded.policy_version,
           changed_by = excluded.changed_by, changed_at = now(),
           version = invoice_global_layout_consents.version + 1
       where invoice_global_layout_consents.version = $4
         and invoice_global_layout_consents.state in ('disabled', 'enabled')
     returning company_id, state, policy_version, version, changed_at`,
    [input.companyId, input.policyVersion, input.actorId, input.expectedVersion],
  );
  return result.rows[0] || null;
}

export async function recordGlobalLayoutConsentEvent(input, db) {
  const result = await db.query(
    `insert into invoice_global_layout_consent_events (
       company_id, actor_id, action, policy_version, idempotency_key
     ) values ($1, $2, $3, $4, $5)
     on conflict (company_id, idempotency_key) do nothing
     returning id`,
    [input.companyId, input.actorId, input.action, input.policyVersion, input.idempotencyKey],
  );
  return result.rows[0] || null;
}

export async function insertGlobalLayoutContribution(input, db = null) {
  if (!db) return withGlobalLayoutTransaction((client) => insertGlobalLayoutContribution(input, client));
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`invoice-global-withdraw:${input.companyId}`]);
  await lockGlobalLayoutArtifact(input, db);
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [
    `invoice-global-contribution:${input.companyId}:${input.structuralFingerprint}`,
  ]);
  const result = await db.query(
    `insert into invoice_global_layout_contributions (
       company_id, run_id, reviewer_id, structural_fingerprint, schema_version,
       hmac_key_version, sanitized_payload, privacy_scanner_version,
       privacy_scan_digest, replay_evidence
     )
     select $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb
     where exists (
       select 1 from invoice_global_layout_consents
       where company_id = $1 and state = 'enabled'
     ) and exists (
       select 1 from invoice_global_layout_hmac_versions
       where key_version = $6 and status in ('active', 'matching')
     ) and (
       select count(*) from invoice_global_layout_contributions
       where company_id = $1 and structural_fingerprint = $4 and state = 'eligible'
     ) < $11
     on conflict (company_id, run_id, schema_version, hmac_key_version) do nothing
     returning id, structural_fingerprint, schema_version, hmac_key_version, state, contributed_at`,
    [input.companyId, input.runId, input.reviewerId, input.structuralFingerprint,
      input.schemaVersion, input.hmacKeyVersion, JSON.stringify(input.sanitizedPayload),
      input.privacyScannerVersion, input.privacyScanDigest, JSON.stringify(input.replayEvidence),
      input.companyLayoutCap],
  );
  const contribution = result.rows[0] || null;
  if (contribution) {
    await queueGlobalLayoutRebuild({
      structuralFingerprint: contribution.structural_fingerprint,
      schemaVersion: contribution.schema_version,
      hmacKeyVersion: contribution.hmac_key_version,
    }, db);
  }
  return contribution;
}

export async function enqueueGlobalLayoutContributionCommand(input, db = { query }) {
  const result = await db.query(
    `insert into invoice_global_layout_contribution_commands (
       company_id, run_id, reviewer_id, review_request_hash, structural_fingerprint,
       schema_version, hmac_key_version, sanitized_payload, privacy_scanner_version,
       privacy_scan_digest, replay_evidence, company_layout_cap
     ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12)
     on conflict (company_id, run_id, review_request_hash) do nothing
     returning id, status, created_at`,
    [input.companyId, input.runId, input.reviewerId, input.reviewRequestHash,
      input.structuralFingerprint, input.schemaVersion, input.hmacKeyVersion,
      JSON.stringify(input.sanitizedPayload), input.privacyScannerVersion,
      input.privacyScanDigest, JSON.stringify(input.replayEvidence), input.companyLayoutCap],
  );
  if (result.rows[0]) return { ...result.rows[0], replayed: false };
  const replay = await db.query(
    `select id, status, created_at from invoice_global_layout_contribution_commands
     where company_id = $1 and run_id = $2 and review_request_hash = $3 limit 1`,
    [input.companyId, input.runId, input.reviewRequestHash],
  );
  return replay.rows[0] ? { ...replay.rows[0], replayed: true } : null;
}

export async function claimGlobalLayoutContributionCommand(db) {
  const result = await db.query(
    `with next as (
       select command.id
       from invoice_global_layout_contribution_commands command
       join invoice_extraction_runs run
         on run.company_id = command.company_id and run.id = command.run_id
       join invoice_global_layout_consents consent on consent.company_id = command.company_id
       where command.status = 'pending' and command.next_attempt_at <= now() and command.attempts < 10
         and run.status = 'reviewed'
         and run.reviewed_by = command.reviewer_id
         and run.review_request_hash = command.review_request_hash
         and consent.state = 'enabled'
       order by command.created_at, command.id for update of command skip locked limit 1
     )
     update invoice_global_layout_contribution_commands command
     set status = 'processing', attempts = attempts + 1, error_code = null
     from next where command.id = next.id returning command.*`,
  );
  return result.rows[0] || null;
}

export async function completeGlobalLayoutContributionCommand(input, db) {
  if (!["pending", "completed", "cancelled", "failed"].includes(input.status)) {
    throw new Error("invalid_global_layout_contribution_command_status");
  }
  const result = await db.query(
    `update invoice_global_layout_contribution_commands
     set status = $2, error_code = $3,
         completed_at = case when $2 in ('completed', 'cancelled', 'failed') then now() else null end,
         next_attempt_at = case when $2 = 'pending'
           then now() + make_interval(secs => least(3600, 30 * power(2, least(attempts, 7))::integer))
           else next_attempt_at end
     where id = $1 and status = 'processing' returning id, status`,
    [input.id, input.status, input.errorCode || null],
  );
  return result.rows[0] || null;
}

export async function queueGlobalLayoutRebuild(input, db = { query }) {
  const result = await db.query(
    `insert into invoice_global_layout_rebuilds (
       structural_fingerprint, schema_version, hmac_key_version
     ) values ($1, $2, $3)
     on conflict (structural_fingerprint, schema_version, hmac_key_version)
       where status in ('queued', 'running', 'validating') do nothing
     returning id, structural_fingerprint, schema_version, hmac_key_version, status`,
    [input.structuralFingerprint, input.schemaVersion, input.hmacKeyVersion],
  );
  return result.rows[0] || null;
}

export async function findActiveGlobalLayoutTemplates({ markerDigests, schemaVersion, hmacKeyVersion, limit = 10 }, db = { query }) {
  const bounded = Math.min(25, Math.max(1, Number(limit) || 10));
  const result = await db.query(
    `select template.id, template.structural_fingerprint, template.schema_version, template.hmac_key_version,
            template.marker_digests, template.template_payload, template.status, template.artifact_version,
            template.support_count, template.company_count, template.critical_exact_match,
            template.totals_reconcile_rate, template.false_match_rate,
            template.privacy_scanner_version, template.privacy_scan_digest
     from invoice_global_layout_templates template
     join invoice_global_layout_hmac_versions hmac on hmac.key_version = template.hmac_key_version
     join invoice_global_layout_release_evidence evidence
       on evidence.id = template.release_evidence_id and evidence.template_id = template.id
     where template.status = 'active' and template.schema_version = $1 and template.hmac_key_version = $2
       and hmac.status in ('active', 'matching') and evidence.status = 'sealed'
       and template.marker_digests && $3::char(64)[]
     order by template.support_count desc, template.critical_exact_match desc, template.updated_at desc, template.id
     limit $4`,
    [schemaVersion, hmacKeyVersion, markerDigests, bounded],
  );
  return result.rows;
}

export async function eligibleGlobalLayoutContributions(input, db = { query }) {
  const result = await db.query(
    `select contribution.id, contribution.company_id, contribution.structural_fingerprint,
            contribution.schema_version, contribution.hmac_key_version,
            contribution.sanitized_payload, contribution.privacy_scanner_version,
            contribution.privacy_scan_digest, contribution.replay_evidence,
            contribution.contributed_at
     from invoice_global_layout_contributions contribution
     join invoice_global_layout_consents consent on consent.company_id = contribution.company_id
     where contribution.structural_fingerprint = $1 and contribution.schema_version = $2
       and contribution.hmac_key_version = $3 and contribution.state = 'eligible' and consent.state = 'enabled'
     order by contribution.company_id, contribution.contributed_at, contribution.id`,
    [input.structuralFingerprint, input.schemaVersion, input.hmacKeyVersion],
  );
  return result.rows;
}

export async function withdrawGlobalLayoutConsent(input, db) {
  await db.query("select pg_advisory_xact_lock(hashtext($1))", [`invoice-global-withdraw:${input.companyId}`]);
  const consent = await db.query(
    `update invoice_global_layout_consents
     set state = 'withdrawing', changed_by = $3, changed_at = now(), version = version + 1
     where company_id = $1 and version = $2 and state = 'enabled'
     returning company_id, state, policy_version, version, changed_at`,
    [input.companyId, input.expectedVersion, input.actorId],
  );
  if (!consent.rows[0]) return null;
  await db.query(
    `update invoice_global_layout_contribution_commands
     set status = 'cancelled', completed_at = now(), error_code = 'consent_withdrawn'
     where company_id = $1 and status in ('pending', 'processing')`,
    [input.companyId],
  );
  const affected = await db.query(
    `select distinct structural_fingerprint, schema_version, hmac_key_version
     from invoice_global_layout_contributions
     where company_id = $1 and state = 'eligible'
     order by structural_fingerprint, schema_version, hmac_key_version`,
    [input.companyId],
  );
  const rebuilds = [];
  for (const row of affected.rows) {
    const identity = {
      structuralFingerprint: row.structural_fingerprint,
      schemaVersion: Number(row.schema_version),
      hmacKeyVersion: row.hmac_key_version,
    };
    await lockGlobalLayoutArtifact(identity, db);
    await db.query(
      `update invoice_global_layout_contributions
       set state = 'tombstoned', revoked_at = now()
       where company_id = $1 and structural_fingerprint = $2
         and schema_version = $3 and hmac_key_version = $4 and state = 'eligible'`,
      [input.companyId, identity.structuralFingerprint, identity.schemaVersion, identity.hmacKeyVersion],
    );
    const quarantined = await db.query(
      `with selected as (
         select id, status from invoice_global_layout_templates
         where structural_fingerprint = $1 and schema_version = $2 and hmac_key_version = $3
           and status in ('shadow', 'canary', 'active')
         for update
       ), changed as (
         update invoice_global_layout_templates template
       set status = 'quarantined', quarantined_at = coalesce(quarantined_at, now()), updated_at = now()
         from selected where template.id = selected.id returning template.id
       ) select selected.id, selected.status from selected join changed on changed.id = selected.id`,
      [identity.structuralFingerprint, identity.schemaVersion, identity.hmacKeyVersion],
    );
    for (const template of quarantined.rows) {
      await db.query(
        `insert into invoice_global_layout_lifecycle_events (
           template_id, from_status, to_status, owner, reason_code
         ) values ($1, $2, 'quarantined', 'revocation_worker', 'tenant_consent_withdrawn')`,
        [template.id, template.status],
      );
    }
    const rebuild = await queueGlobalLayoutRebuild(identity, db);
    if (rebuild) rebuilds.push(rebuild);
  }
  if (!affected.rows.length) {
    const completed = await completeGlobalLayoutWithdrawal({ companyId: input.companyId }, db);
    return { consent: completed || consent.rows[0], rebuilds: [] };
  }
  return { consent: consent.rows[0], rebuilds };
}

export async function completeGlobalLayoutWithdrawal(input, db = { query }) {
  const pending = await db.query(
    `select count(*)::integer as count
     from invoice_global_layout_rebuilds rebuild
     where rebuild.status in ('queued', 'running', 'validating')
       and exists (
         select 1 from invoice_global_layout_contributions contribution
         where contribution.company_id = $1 and contribution.state = 'tombstoned'
           and contribution.structural_fingerprint = rebuild.structural_fingerprint
           and contribution.schema_version = rebuild.schema_version
           and contribution.hmac_key_version = rebuild.hmac_key_version
       )`,
    [input.companyId],
  );
  if (Number(pending.rows[0]?.count || 0) !== 0) return null;
  const result = await db.query(
    `update invoice_global_layout_consents
     set state = 'disabled', changed_at = now(), version = version + 1
     where company_id = $1 and state = 'withdrawing'
     returning company_id, state, policy_version, version, changed_by, changed_at`,
    [input.companyId],
  );
  const completed = result.rows[0] || null;
  if (completed) {
    await db.query(
      `insert into invoice_global_layout_consent_events (
         company_id, actor_id, action, policy_version, idempotency_key
       ) values ($1, $2, 'withdrawal_completed', $3, $4)
       on conflict (company_id, idempotency_key) do nothing`,
      [completed.company_id, completed.changed_by, completed.policy_version,
        `withdrawal-completed-${completed.version}`],
    );
  }
  return completed;
}

export async function claimGlobalLayoutRebuild(db) {
  const result = await db.query(
    `with exhausted as (
       update invoice_global_layout_rebuilds rebuild
       set status = 'running', error_code = 'global_layout_rebuild_attempts_exhausted',
           started_at = now(), completed_at = null
       where id in (
         select id from invoice_global_layout_rebuilds
         where status in ('running', 'validating') and attempts >= 10
           and started_at <= now() - interval '5 minutes'
         order by started_at, id
         for update skip locked
         limit 1
       )
       returning rebuild.*, true as terminal
     ), next as (
       select id from invoice_global_layout_rebuilds
       where not exists (select 1 from exhausted) and attempts < 10 and (
         (status = 'queued' and requested_at <= now())
         or (status in ('running', 'validating') and started_at <= now() - interval '5 minutes')
       )
       order by requested_at, id
       for update skip locked limit 1
     ), claimed as (
     update invoice_global_layout_rebuilds rebuild
     set status = 'running', attempts = attempts + 1, started_at = now(), error_code = null
     from next where rebuild.id = next.id
     returning rebuild.*, false as terminal
     )
     select * from exhausted union all select * from claimed`,
  );
  return result.rows[0] || null;
}

export async function getGlobalLayoutRebuildForUpdate({ id }, db) {
  const result = await db.query(
    `select * from invoice_global_layout_rebuilds where id = $1 and status in ('running', 'validating')
     limit 1 for update`,
    [id],
  );
  return result.rows[0] || null;
}

export async function withdrawingCompaniesForArtifact(input, db = { query }) {
  const result = await db.query(
    `select distinct contribution.company_id
     from invoice_global_layout_contributions contribution
     join invoice_global_layout_consents consent on consent.company_id = contribution.company_id
     where contribution.structural_fingerprint = $1 and contribution.schema_version = $2
       and contribution.hmac_key_version = $3 and contribution.state = 'tombstoned'
       and consent.state = 'withdrawing' order by contribution.company_id`,
    [input.structuralFingerprint, input.schemaVersion, input.hmacKeyVersion],
  );
  return result.rows.map((row) => row.company_id);
}

export async function markGlobalLayoutRebuild(input, db = { query }) {
  if (!["queued", "validating", "succeeded", "failed"].includes(input.status)) throw new Error("invalid_global_layout_rebuild_status");
  const result = await db.query(
    `update invoice_global_layout_rebuilds
     set status = $2, error_code = $3,
         requested_at = case when $2 = 'queued'
           then now() + interval '5 seconds' * power(2, least(6, greatest(0, attempts - 1)))
           else requested_at end,
         started_at = case when $2 = 'queued' then null else started_at end,
         completed_at = case when $2 in ('succeeded', 'failed') then now() else null end
     where id = $1 and status in ('running', 'validating') returning *`,
    [input.id, input.status, input.errorCode || null],
  );
  return result.rows[0] || null;
}

export async function createGlobalLayoutArtifact(input, db = null) {
  if (!db) return withGlobalLayoutTransaction((client) => createGlobalLayoutArtifact(input, client));
  const status = LIFECYCLE_STATES.has(input.status) ? input.status : "shadow";
  await lockGlobalLayoutHmacLifecycle(db);
  await lockGlobalLayoutArtifact(input, db);
  const result = await db.query(
    `insert into invoice_global_layout_templates (
       structural_fingerprint, schema_version, hmac_key_version, marker_digests,
       template_payload, status, artifact_version, support_count, company_count,
       max_company_share, critical_exact_match, totals_reconcile_rate,
       false_match_rate, privacy_scanner_version, privacy_scan_digest, quarantined_at
     )
     select $1, $2, $3, $4::char(64)[], $5::jsonb, $6,
            (select coalesce(max(existing.artifact_version), 0) + 1
               from invoice_global_layout_templates existing
              where existing.structural_fingerprint = $1
                and existing.schema_version = $2
                and existing.hmac_key_version = $3),
            $7, $8, $9, $10, $11, $12, $13, $14,
            case when $6 = 'quarantined' then now() else null end
     where exists (
       select 1 from invoice_global_layout_hmac_versions hmac
       where hmac.key_version = $3 and hmac.status in ('active', 'matching')
     )
     returning id, structural_fingerprint, schema_version, hmac_key_version,
               status, artifact_version, support_count, company_count, created_at`,
    [input.structuralFingerprint, input.schemaVersion, input.hmacKeyVersion, input.markerDigests,
      JSON.stringify(input.templatePayload), status, input.supportCount,
      input.companyCount, input.maxCompanyShare, input.criticalExactMatch,
      input.totalsReconcileRate, input.falseMatchRate, input.privacyScannerVersion,
      input.privacyScanDigest],
  );
  return result.rows[0];
}

export async function sealGlobalLayoutReleaseEvidence(input, db = { query }) {
  const result = await db.query(
    `insert into invoice_global_layout_release_evidence (
       template_id, sealed_manifest_hash, evaluator_version, eligible_count,
       returned_count, correct_count, negative_count, false_positive_count,
       totals_applicable_count, totals_reconciled_count, company_count,
       max_company_share, privacy_scanner_version, privacy_scan_digest
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     on conflict (template_id, sealed_manifest_hash) do nothing returning *`,
    [input.templateId, input.sealedManifestHash, input.evaluatorVersion,
      input.eligibleCount, input.returnedCount, input.correctCount, input.negativeCount,
      input.falsePositiveCount, input.totalsApplicableCount, input.totalsReconciledCount,
      input.companyCount, input.maxCompanyShare, input.privacyScannerVersion, input.privacyScanDigest],
  );
  return result.rows[0] || null;
}

export async function transitionGlobalLayoutArtifact(input, db = null) {
  const allowed = LIFECYCLE_TRANSITIONS.get(input.expectedStatus);
  if (!allowed?.has(input.nextStatus)) throw new Error("invalid_global_layout_lifecycle_transition");
  if (!db) return withGlobalLayoutTransaction((client) => transitionGlobalLayoutArtifact(input, client));
  await lockGlobalLayoutHmacLifecycle(db);
  const selected = await db.query(
    `select structural_fingerprint, schema_version, hmac_key_version
     from invoice_global_layout_templates where id = $1 limit 1`, [input.id],
  );
  if (!selected.rows[0]) return null;
  await lockGlobalLayoutArtifact({
    structuralFingerprint: selected.rows[0].structural_fingerprint,
    schemaVersion: Number(selected.rows[0].schema_version),
    hmacKeyVersion: selected.rows[0].hmac_key_version,
  }, db);
  const result = await db.query(
    `update invoice_global_layout_templates template
     set status = $3, release_evidence_id = case when $3 in ('canary', 'active') then $4 else release_evidence_id end,
         quarantined_at = case when $3 = 'quarantined' then now() else null end,
         updated_at = now()
     from invoice_global_layout_release_evidence evidence,
          invoice_global_layout_hmac_versions hmac
     where template.id = $1 and template.status = $2
       and evidence.id = $4 and evidence.template_id = template.id and evidence.status = 'sealed'
       and evidence.privacy_scanner_version = template.privacy_scanner_version
       and evidence.privacy_scan_digest = template.privacy_scan_digest
       and hmac.key_version = template.hmac_key_version and hmac.status in ('active', 'matching')
       and ($3 not in ('canary', 'active') or (
         evidence.eligible_count >= 300 and evidence.returned_count::numeric / evidence.eligible_count >= 0.95
         and evidence.correct_count::numeric / evidence.returned_count >= 0.98
         and evidence.totals_reconciled_count = evidence.totals_applicable_count
         and evidence.false_positive_count::numeric / evidence.negative_count < 0.001
         and evidence.company_count >= 3 and evidence.max_company_share <= 0.4
       ))
     returning template.id, template.structural_fingerprint, template.schema_version, template.hmac_key_version,
               template.status, template.artifact_version, template.support_count, template.company_count, template.updated_at`,
    [input.id, input.expectedStatus, input.nextStatus, input.releaseEvidenceId],
  );
  const transitioned = result.rows[0] || null;
  if (transitioned) {
    await db.query(
      `insert into invoice_global_layout_lifecycle_events (
         template_id, from_status, to_status, release_evidence_id, owner, reason_code
       ) values ($1, $2, $3, $4, 'release_evaluator', $5)`,
      [input.id, input.expectedStatus, input.nextStatus, input.releaseEvidenceId, input.reasonCode],
    );
  }
  return transitioned;
}

export async function retireGlobalLayoutArtifacts(input, db = { query }) {
  const result = await db.query(
    `update invoice_global_layout_templates set status = 'retired', quarantined_at = null, updated_at = now()
     where structural_fingerprint = $1 and schema_version = $2 and hmac_key_version = $3
       and status = 'quarantined'`,
    [input.structuralFingerprint, input.schemaVersion, input.hmacKeyVersion],
  );
  return result.rowCount;
}

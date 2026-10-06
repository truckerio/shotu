import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPool, query } from "../pool.js";
import { canonicalFinancialHash } from "../../modules/customer-documents/customer-financial-calculator.js";
import { commercialScopeHash } from "../../modules/customer-documents/customer-document-reconciliation.js";

const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RESPONSE_TYPES = new Set(["accepted", "declined", "changes_requested"]);
const GRANT_ACTIONS = new Set(["view_revision", "respond_revision", "customer_chat"]);

function domainError(code, details = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function requireHash(value, name) {
  if (!HASH_PATTERN.test(String(value || ""))) throw domainError("CUSTOMER_DOCUMENT_INVALID_HASH", { field: name });
  return value;
}

function tokenHash(rawToken) {
  if (typeof rawToken !== "string" || rawToken.length < 32) throw domainError("CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE");
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

function profileVersionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    companyId: row.company_id,
    locationId: row.location_id || null,
    version: Number(row.version),
    shopIdentity: row.shop_identity,
    documentTerms: row.document_terms,
    authorizationText: row.authorization_text,
    discountPolicy: row.discount_policy,
    lineTaxPolicy: row.line_tax_policy,
    documentNumbering: {
      estimate: { prefix: row.estimate_number_prefix || "EST-", digits: Number(row.estimate_number_digits || 6) },
      invoice: { prefix: row.invoice_number_prefix || "INV-", digits: Number(row.invoice_number_digits || 6) },
    },
    estimateValidityDays: row.estimate_validity_days === null || row.estimate_validity_days === undefined
      ? null : Number(row.estimate_validity_days),
    defaultCurrency: row.default_currency,
    taxProfileVersionId: row.tax_profile_version_id,
    taxComponents: row.tax_components || null,
    taxCurrency: row.tax_currency || null,
    taxState: row.tax_state || null,
    informationalOnly: row.informational_only === true,
    publishedByUserId: row.published_by_user_id,
    publishedAt: row.published_at,
  };
}

function revisionRow(row) {
  if (!row) return null;
  const result = {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    documentId: row.document_id,
    draftId: row.draft_id || null,
    workorderId: row.workorder_id || null,
    documentType: row.document_type,
    documentNumber: row.document_number,
    revisionNumber: Number(row.revision_number),
    predecessorRevisionId: row.predecessor_revision_id || null,
    profileVersionId: row.profile_version_id,
    snapshot: row.snapshot,
    contentHash: row.content_hash,
    financialFingerprint: row.financial_fingerprint,
    recipientSnapshot: row.recipient_snapshot,
    currency: row.currency,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    totalAmount: row.total_amount,
    invoiceReadiness: row.invoice_readiness || null,
    approvedEstimateRevisionId: row.approved_estimate_revision_id || null,
    activationAuthorized: row.activation_authorized === true,
    issuedByUserId: row.issued_by_user_id,
    issuedAt: row.issued_at,
  };
  if (Object.hasOwn(row, "response_event_type")) {
    const current = row.is_latest === true;
    const status = row.document_type === "invoice" ? "not_applicable" : row.response_event_type || "pending";
    result.response = {
      status,
      respondedAt: row.response_created_at || null,
      customerName: row.response_metadata?.customerName || null,
    };
    result.eligibility = {
      canRespond: row.document_type === "estimate" && current && status === "pending",
      canActivate: row.document_type === "estimate" && current && status === "accepted",
    };
  }
  return result;
}

function grantRow(row) {
  if (!row) return null;
  return {
    id: row.grant_id || row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    documentId: row.document_id,
    revisionId: row.grant_revision_id || row.revision_id,
    tokenHint: row.token_hint,
    allowedActions: row.allowed_actions,
    workorderId: row.grant_workorder_id ?? row.workorder_id ?? null,
    issuedAt: row.grant_issued_at || row.issued_at,
    expiresAt: row.grant_expires_at || row.expires_at,
    revokedAt: row.grant_revoked_at || row.revoked_at || null,
    lastUsedAt: row.grant_last_used_at || row.last_used_at || null,
  };
}

export function customerDocumentSourceLineageMatches(document, input) {
  return (document?.draft_id || null) === (input?.draftId || null)
    && (document?.workorder_id || null) === (input?.workorderId || null);
}

async function transact(dependencies, work) {
  if (dependencies.client) return work(dependencies.client);
  const pool = dependencies.pool || getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function commandLock(client, input, operation) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [
    `customer-document:${operation}:${input.companyId}:${input.actorId || input.tokenHash}:${input.idempotencyKey}`,
  ]);
}

async function replayRevision(client, input) {
  const result = await client.query(
    `select revision.*, document.document_type, document.document_number
       from customer_document_revisions revision
       join customer_documents document
         on document.company_id=revision.company_id and document.id=revision.document_id
      where revision.company_id=$1 and revision.issued_by_user_id=$2 and revision.idempotency_key=$3
      limit 1`,
    [input.companyId, input.actorId, input.idempotencyKey],
  );
  if (!result.rows[0]) return null;
  if (result.rows[0].request_hash !== input.requestHash) throw domainError("CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT");
  return { revision: revisionRow(result.rows[0]), replayed: true };
}

async function replayStaffEvent(client, input) {
  const result = await client.query(
    `select * from customer_document_events
      where company_id=$1 and actor_user_id=$2 and idempotency_key=$3 limit 1`,
    [input.companyId, input.actorId, input.idempotencyKey],
  );
  if (!result.rows[0]) return null;
  if (result.rows[0].request_hash !== input.requestHash) throw domainError("CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT");
  return result.rows[0];
}

export async function publishCustomerDocumentProfile(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "publish-profile");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `customer-document-profile:${input.companyId}:${input.locationId || "company"}`,
    ]);
    const replay = await client.query(
      `select version.*, profile.location_id
         from customer_document_profile_versions version
         join customer_document_profiles profile
           on profile.company_id=version.company_id and profile.id=version.profile_id
        where version.company_id=$1 and version.published_by_user_id=$2 and version.idempotency_key=$3
        limit 1`,
      [input.companyId, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== input.requestHash) throw domainError("CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT");
      return { profileVersion: profileVersionRow(replay.rows[0]), replayed: true };
    }

    const tax = await client.query(
      `select version.id,version.currency
         from inventory_tax_profile_versions version
         join inventory_tax_profiles profile
           on profile.company_id=version.company_id and profile.id=version.profile_id
        where version.company_id=$1 and version.id=$2
          and profile.current_version_id=version.id and version.state='active'
        limit 1`,
      [input.companyId, input.taxProfileVersionId],
    );
    if (!tax.rows[0]) throw domainError("CUSTOMER_DOCUMENT_TAX_PROFILE_UNAVAILABLE");
    if (tax.rows[0].currency !== input.defaultCurrency) throw domainError("CUSTOMER_DOCUMENT_CURRENCY_MISMATCH");

    let profile;
    if (input.profileId) {
      profile = (await client.query(
        `select * from customer_document_profiles
          where company_id=$1 and id=$2 and location_id is not distinct from $3::uuid for update`,
        [input.companyId, input.profileId, input.locationId || null],
      )).rows[0];
    } else {
      profile = (await client.query(
        `select * from customer_document_profiles
          where company_id=$1 and location_id is not distinct from $2::uuid for update`,
        [input.companyId, input.locationId || null],
      )).rows[0];
      if (!profile) {
        profile = (await client.query(
          `insert into customer_document_profiles(company_id,location_id,created_by_user_id)
           values($1,$2,$3) returning *`,
          [input.companyId, input.locationId || null, input.actorId],
        )).rows[0];
      }
    }
    if (!profile) throw domainError("CUSTOMER_DOCUMENT_PROFILE_NOT_FOUND");

    let currentVersion = 0;
    if (profile.current_version_id) {
      const current = (await client.query(
        `select version from customer_document_profile_versions
          where company_id=$1 and profile_id=$2 and id=$3`,
        [input.companyId, profile.id, profile.current_version_id],
      )).rows[0];
      currentVersion = Number(current?.version || 0);
    }
    if (currentVersion !== Number(input.expectedVersion)) {
      throw domainError("CUSTOMER_DOCUMENT_PROFILE_VERSION_CONFLICT", { currentVersion });
    }

    const inserted = (await client.query(
      `insert into customer_document_profile_versions(
         company_id,profile_id,version,previous_version_id,shop_identity,document_terms,
         authorization_text,discount_policy,line_tax_policy,default_currency,tax_profile_version_id,
         estimate_number_prefix,estimate_number_digits,invoice_number_prefix,invoice_number_digits,
         estimate_validity_days,published_by_user_id,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       returning *`,
      [input.companyId, profile.id, currentVersion + 1, profile.current_version_id,
        JSON.stringify(input.shopIdentity), JSON.stringify(input.documentTerms), input.authorizationText,
        JSON.stringify(input.discountPolicy), JSON.stringify(input.lineTaxPolicy), input.defaultCurrency, input.taxProfileVersionId,
        input.documentNumbering.estimate.prefix, input.documentNumbering.estimate.digits,
        input.documentNumbering.invoice.prefix, input.documentNumbering.invoice.digits,
        input.estimateValidityDays, input.actorId, input.idempotencyKey, input.requestHash],
    )).rows[0];
    await client.query(
      "update customer_document_profiles set current_version_id=$3 where company_id=$1 and id=$2",
      [input.companyId, profile.id, inserted.id],
    );
    return { profileVersion: profileVersionRow({ ...inserted, location_id: profile.location_id }), replayed: false };
  });
}

export async function getCustomerDocumentProfileForScope(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select version.*,profile.location_id,tax.components as tax_components,
            tax.currency as tax_currency,tax.state as tax_state
       from customer_document_profiles profile
       join customer_document_profile_versions version
         on version.company_id=profile.company_id and version.id=profile.current_version_id
       left join inventory_tax_profile_versions tax
         on tax.company_id=version.company_id and tax.id=version.tax_profile_version_id
      where profile.company_id=$1 and (profile.location_id=$2 or profile.location_id is null)
      order by profile.location_id nulls last limit 1`,
    [input.companyId, input.locationId],
  );
  return profileVersionRow(result.rows[0]);
}

export async function ensureInformationalCustomerDocumentProfile(input, client) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`informational-profile:${input.companyId}`]);
  let profile = await getCustomerDocumentProfileForScope(input, { query: client.query.bind(client) });
  if (profile) return profile;
  const company = (await client.query("select name from companies where id=$1", [input.companyId])).rows[0];
  if (!company) throw domainError("CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE");
  const record = (await client.query(
    `insert into customer_document_profiles(company_id,location_id,created_by_user_id)
     values($1,null,$2) on conflict(company_id) where location_id is null do nothing returning *`,
    [input.companyId, input.actorId],
  )).rows[0] || (await client.query(
    "select * from customer_document_profiles where company_id=$1 and location_id is null for update",
    [input.companyId],
  )).rows[0];
  if (!record.current_version_id) {
    const shopIdentity = { legalName: company.name, tradeName: null, address: null, phone: null,
      email: null, registrationIdentifiers: {}, logoUrl: null, accentColor: null };
    const lineTaxPolicy = { labor: "not_configured", part: "not_configured", shop_supply: "not_configured",
      fee: "not_configured", core_charge: "not_configured", credit: "out_of_scope" };
    const version = (await client.query(
      `insert into customer_document_profile_versions(company_id,profile_id,version,shop_identity,
        document_terms,authorization_text,discount_policy,line_tax_policy,default_currency,
        tax_profile_version_id,published_by_user_id,idempotency_key,request_hash,informational_only)
       values($1,$2,1,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7::jsonb,'USD',null,$8,$9,$10,true)
       returning id`,
      [input.companyId, record.id, JSON.stringify(shopIdentity),
        JSON.stringify({ estimate: "Scope and pricing to be confirmed.", invoice: "", warranty: "", footer: "" }),
        "Customer approval is not required for this informational Estimate.",
        JSON.stringify({ maxOfficePercentage: "0", reasonRequired: true }), JSON.stringify(lineTaxPolicy),
        input.actorId, `informational-profile:${record.id}`,
        canonicalFinancialHash({ companyId: input.companyId, profileId: record.id, informationalOnly: true })],
    )).rows[0];
    await client.query("update customer_document_profiles set current_version_id=$3 where company_id=$1 and id=$2",
      [input.companyId, record.id, version.id]);
  }
  profile = await getCustomerDocumentProfileForScope(input, { query: client.query.bind(client) });
  return profile;
}

async function reserveDocumentNumber(client, companyId, documentType, numbering) {
  await client.query(
    `insert into customer_document_number_series(company_id,document_type,prefix,digits)
     values($1,$2,$3,$4) on conflict(company_id,document_type) do nothing`,
    [companyId, documentType, numbering.prefix, numbering.digits],
  );
  const series = (await client.query(
    `select * from customer_document_number_series
      where company_id=$1 and document_type=$2 for update`,
    [companyId, documentType],
  )).rows[0];
  const value = Number(series.next_number);
  await client.query(
    `update customer_document_number_series
        set next_number=next_number+1,updated_at=now()
      where company_id=$1 and id=$2`,
    [companyId, series.id],
  );
  return {
    seriesId: series.id,
    value,
    number: `${numbering.prefix}${String(value).padStart(numbering.digits, "0")}`,
  };
}

async function validateCurrentProfile(client, input) {
  const result = await client.query(
    `select version.id,profile.location_id,version.default_currency,
            version.estimate_number_prefix,version.estimate_number_digits,
            version.invoice_number_prefix,version.invoice_number_digits,version.estimate_validity_days,
            tax.currency as tax_currency,tax.state as tax_state,version.informational_only
       from customer_document_profile_versions version
       join customer_document_profiles profile
         on profile.company_id=version.company_id and profile.id=version.profile_id
       left join inventory_tax_profile_versions tax
         on tax.company_id=version.company_id and tax.id=version.tax_profile_version_id
      where version.company_id=$1 and version.id=$2 and profile.current_version_id=version.id
        and (profile.location_id is null or profile.location_id=$3)
      limit 1
      for share of profile,version`,
    [input.companyId, input.profileVersionId, input.locationId],
  );
  const profile = result.rows[0];
  if (!profile || (profile.informational_only && !input.informationalOnly)
    || (!profile.informational_only && profile.tax_state !== "active")) {
    throw domainError("CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE");
  }
  if (profile.default_currency !== input.currency
    || (!profile.informational_only && profile.tax_currency !== input.currency)) {
    throw domainError("CUSTOMER_DOCUMENT_CURRENCY_MISMATCH");
  }
  return profile;
}

export function approvedEstimateMatchesInvoiceReadiness(approved, readiness) {
  const sourceKind = approved?.snapshot?.sourceEvidence?.kind;
  if (sourceKind === "workorder") {
    return readiness?.sourceMatchMode === "workorder_pricing_fingerprint"
      && approved.snapshot.sourceEvidence.pricingFingerprint === readiness.actualPricingFingerprint;
  }
  if (sourceKind !== "draft" || approved?.activation_authorized !== true
    || readiness?.sourceMatchMode !== "activation_commercial_scope"
    || !HASH_PATTERN.test(String(readiness?.actualScopeHash || ""))
    || !HASH_PATTERN.test(String(readiness?.acceptedScopeHash || ""))) return false;
  return readiness.actualScopeHash === readiness.acceptedScopeHash
    && commercialScopeHash(approved.snapshot) === readiness.acceptedScopeHash;
}

async function validateInvoiceReadiness(client, input, document) {
  if (document.document_type !== "invoice") {
    if (input.invoiceReadiness || input.approvedEstimateRevisionId) {
      throw domainError("CUSTOMER_DOCUMENT_ESTIMATE_READINESS_INVALID");
    }
    return;
  }
  const readiness = input.invoiceReadiness;
  if (!readiness || !Number.isInteger(Number(readiness.workorderVersion))
    || !HASH_PATTERN.test(String(readiness.reconciliationHash || ""))
    || !HASH_PATTERN.test(String(readiness.actualPricingFingerprint || ""))
    || !String(readiness.authorizationBasis || "").trim()) {
    throw domainError("CUSTOMER_DOCUMENT_INVOICE_NOT_READY");
  }
  const workorder = (await client.query(
    `select id,status,progress_version from operational_workorders
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    [input.companyId, input.locationId, document.workorder_id],
  )).rows[0];
  if (!workorder || workorder.status !== "mechanic_done"
    || Number(workorder.progress_version) !== Number(readiness.workorderVersion)) {
    throw domainError("CUSTOMER_DOCUMENT_INVOICE_NOT_READY");
  }
  if (readiness.authorizationBasis === "accepted_estimate" && !input.approvedEstimateRevisionId) {
    throw domainError("CUSTOMER_DOCUMENT_APPROVED_ESTIMATE_REQUIRED");
  }
  if (input.approvedEstimateRevisionId) {
    const approved = await client.query(
      `with latest_estimate as (
         select revision.id
           from customer_document_revisions revision
           join customer_documents estimate
             on estimate.company_id=revision.company_id and estimate.id=revision.document_id
          where revision.company_id=$1 and estimate.document_type='estimate'
            and estimate.location_id=$3 and estimate.workorder_id=$4
          order by revision.issued_at desc,revision.id desc limit 1
       )
       select revision.*,
              exists (
                select 1 from workorder_authorization_events auth_event
                 where auth_event.company_id=revision.company_id
                   and auth_event.workorder_id=$4
                   and auth_event.classification='required_external_customer'
                   and auth_event.accepted_estimate_revision_id=revision.id
              ) as activation_authorized
         from latest_estimate latest
         join customer_document_revisions revision on revision.id=latest.id
        where revision.id=$2
          and exists (
            select 1 from customer_document_events event
            where event.company_id=revision.company_id and event.revision_id=revision.id
              and event.event_type='accepted'
          )
          and not exists (
            select 1 from customer_document_events event
            where event.company_id=revision.company_id and event.revision_id=revision.id
              and event.event_type in ('voided','superseded')
          )`,
      [input.companyId, input.approvedEstimateRevisionId, input.locationId, document.workorder_id],
    );
    if (!approvedEstimateMatchesInvoiceReadiness(approved.rows[0], readiness)) {
      throw domainError("CUSTOMER_DOCUMENT_APPROVED_ESTIMATE_INVALID");
    }
  }
}

export async function issueCustomerDocumentRevision(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  requireHash(input.financialFingerprint, "financialFingerprint");
  const totals = input.snapshot?.totals;
  if (!totals || input.snapshot.financialFingerprint !== input.financialFingerprint
    || totals.currency !== input.currency
    || String(totals.subtotal) !== String(input.subtotal)
    || String(totals.discountTotal) !== String(input.discountTotal)
    || String(totals.tax) !== String(input.taxTotal)
    || String(totals.total) !== String(input.totalAmount)) {
    throw domainError("CUSTOMER_DOCUMENT_FINANCIAL_EVIDENCE_MISMATCH");
  }
  if (!new Set(["estimate", "invoice"]).has(input.documentType)) throw domainError("CUSTOMER_DOCUMENT_TYPE_INVALID");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "issue");
    const replay = await replayRevision(client, input);
    if (replay) return replay;
    const profile = await validateCurrentProfile(client, input);

    let document;
    if (input.documentId) {
      document = (await client.query(
        `select * from customer_documents
          where company_id=$1 and location_id=$2 and id=$3 for update`,
        [input.companyId, input.locationId, input.documentId],
      )).rows[0];
      if (!document || document.document_type !== input.documentType) {
        throw domainError("CUSTOMER_DOCUMENT_NOT_FOUND");
      }
    } else {
      if (input.documentType === "invoice" && !input.workorderId) throw domainError("CUSTOMER_DOCUMENT_INVOICE_WORKORDER_REQUIRED");
      if (input.documentType === "invoice") {
        const existingInvoice = await client.query(
          `select id from customer_documents
            where company_id=$1 and location_id=$2 and workorder_id=$3 and document_type='invoice'
            limit 1 for update`,
          [input.companyId, input.locationId, input.workorderId],
        );
        if (existingInvoice.rows[0]) {
          throw domainError("CUSTOMER_DOCUMENT_REVISION_CONFLICT", { documentId: existingInvoice.rows[0].id });
        }
      }
      if (input.documentType === "estimate" && input.draftId) {
        const draft = await client.query(
          `select id from workorder_drafts
            where company_id=$1 and location_id=$2 and id=$3 and status='active' for update`,
          [input.companyId, input.locationId, input.draftId],
        );
        if (!draft.rows[0]) throw domainError("CUSTOMER_DOCUMENT_DRAFT_NOT_ISSUABLE");
      }
      const reserved = await reserveDocumentNumber(client, input.companyId, input.documentType,
        input.documentType === "estimate"
          ? { prefix: profile.estimate_number_prefix || "EST-", digits: Number(profile.estimate_number_digits || 6) }
          : { prefix: profile.invoice_number_prefix || "INV-", digits: Number(profile.invoice_number_digits || 6) });
      document = (await client.query(
        `insert into customer_documents(
           company_id,location_id,draft_id,workorder_id,document_type,number_series_id,
           number_value,document_number,created_by_user_id
         ) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [input.companyId, input.locationId, input.draftId || null, input.workorderId || null,
          input.documentType, reserved.seriesId, reserved.value, reserved.number, input.actorId],
      )).rows[0];
    }

    if (document.workorder_id && document.document_type === "estimate") {
      const workorder = await client.query(
        `select id from operational_workorders
          where company_id=$1 and location_id=$2 and id=$3 for update`,
        [input.companyId, input.locationId, document.workorder_id],
      );
      if (!workorder.rows[0]) throw domainError("CUSTOMER_DOCUMENT_WORKORDER_NOT_FOUND");
    }
    if (!customerDocumentSourceLineageMatches(document, input)) {
      throw domainError("CUSTOMER_DOCUMENT_SOURCE_LINEAGE_CONFLICT");
    }

    const latest = (await client.query(
      `select * from customer_document_revisions
        where company_id=$1 and document_id=$2 order by revision_number desc limit 1`,
      [input.companyId, document.id],
    )).rows[0] || null;
    if ((latest?.id || null) !== (input.predecessorRevisionId || null)) {
      throw domainError("CUSTOMER_DOCUMENT_REVISION_CONFLICT", { currentRevisionId: latest?.id || null });
    }
    const terminal = latest && (await client.query(
      `select event_type from customer_document_events
        where company_id=$1 and revision_id=$2 and event_type in ('voided','superseded') limit 1`,
      [input.companyId, latest.id],
    )).rows[0];
    if (terminal) throw domainError("CUSTOMER_DOCUMENT_REVISION_CLOSED");
    await validateInvoiceReadiness(client, input, document);

    const revisionNumber = latest ? Number(latest.revision_number) + 1 : 1;
    const revisionId = randomUUID();
    const issuedAt = (await client.query("select transaction_timestamp() as issued_at")).rows[0].issued_at;
    const finalizedSnapshot = {
      ...input.snapshot,
      document: {
        ...(input.snapshot?.document || {}),
        id: document.id,
        revisionId,
        type: document.document_type,
        number: document.document_number,
        revision: revisionNumber,
        state: "issued",
        issuedAt: new Date(issuedAt).toISOString(),
        expiresAt: document.document_type === "estimate" && profile.estimate_validity_days
          ? new Date(new Date(issuedAt).getTime() + Number(profile.estimate_validity_days) * 86_400_000).toISOString()
          : null,
      },
    };
    const contentHash = canonicalFinancialHash(finalizedSnapshot);
    const inserted = (await client.query(
      `insert into customer_document_revisions(
         id,company_id,location_id,document_id,revision_number,predecessor_revision_id,profile_version_id,
         snapshot,content_hash,financial_fingerprint,recipient_snapshot,currency,subtotal,
         discount_total,tax_total,total_amount,invoice_readiness,approved_estimate_revision_id,
         issued_by_user_id,issued_at,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17::jsonb,$18,$19,$20,$21,$22)
       returning *`,
      [revisionId, input.companyId, input.locationId, document.id, revisionNumber,
        latest?.id || null, input.profileVersionId, JSON.stringify(finalizedSnapshot), contentHash,
        input.financialFingerprint, JSON.stringify(input.recipientSnapshot), input.currency, input.subtotal,
        input.discountTotal, input.taxTotal, input.totalAmount,
        input.invoiceReadiness ? JSON.stringify(input.invoiceReadiness) : null,
        input.approvedEstimateRevisionId || null, input.actorId, issuedAt, input.idempotencyKey, input.requestHash],
    )).rows[0];

    await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,displayed_amount,currency,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'issued','staff',$6,$7,$8,$9::jsonb,$10,$11)`,
      [input.companyId, input.locationId, document.id, inserted.id, inserted.content_hash,
        input.actorId, inserted.total_amount, inserted.currency, JSON.stringify({
          sourceEvidence: inserted.snapshot?.sourceEvidence || null,
          discountEvidence: {
            lines: (inserted.snapshot?.lines || []).map((line) => ({ id: line.id, discount: line.discountEvidence || null })),
            document: inserted.snapshot?.discountEvidence?.documentDiscount || null,
          },
        }), input.idempotencyKey, input.requestHash],
    );
    if (latest) {
      await client.query(
        `insert into customer_document_events(
           company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
           actor_user_id,displayed_amount,currency,metadata,idempotency_key,request_hash
         ) values($1,$2,$3,$4,$5,'superseded','staff',$6,$7,$8,$9::jsonb,$10,$11)`,
        [input.companyId, input.locationId, document.id, latest.id, latest.content_hash, input.actorId,
          latest.total_amount, latest.currency, JSON.stringify({ successorRevisionId: inserted.id }),
          `supersede:${inserted.id}`, input.requestHash],
      );
    }
    return {
      revision: revisionRow({ ...inserted, document_type: document.document_type, document_number: document.document_number }),
      replayed: false,
    };
  });
}

export async function createCustomerDocumentGrant(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  const rawToken = dependencies.tokenFactory ? dependencies.tokenFactory() : randomBytes(32).toString("base64url");
  const digest = tokenHash(rawToken);
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "grant");
    const replay = await client.query(
      `select * from customer_document_access_grants
        where company_id=$1 and issued_by_user_id=$2 and idempotency_key=$3 limit 1`,
      [input.companyId, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== input.requestHash) throw domainError("CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT");
      return { grant: grantRow(replay.rows[0]), rawToken: null, replayed: true };
    }
    const revision = (await client.query(
      `select revision.*,document.document_type,document.workorder_id,
          coalesce(auth_event.classification,draft.authorization_classification) as authorization_classification
         from customer_document_revisions revision
         join customer_documents document
           on document.company_id=revision.company_id and document.id=revision.document_id
         left join workorder_drafts draft on draft.company_id=document.company_id and draft.id=document.draft_id
         left join workorder_authorization_events auth_event
           on auth_event.company_id=document.company_id and auth_event.workorder_id=document.workorder_id
        where revision.company_id=$1 and revision.location_id=$2 and revision.id=$3
        for update of document,revision`,
      [input.companyId, input.locationId, input.revisionId],
    )).rows[0];
    if (!revision) throw domainError("CUSTOMER_DOCUMENT_REVISION_NOT_FOUND");
    if (revision.authorization_classification === "approval_not_required" && !revision.workorder_id) {
      throw domainError("CUSTOMER_DOCUMENT_GRANT_NOT_READY");
    }
    const terminal = (await client.query(
      `select event_type from customer_document_events
        where company_id=$1 and revision_id=$2
          and event_type in ('accepted','declined','changes_requested','voided','superseded')
        order by created_at desc,id desc limit 1`,
      [input.companyId, revision.id],
    )).rows[0];
    const latest = (await client.query(
      `select id from customer_document_revisions
        where company_id=$1 and document_id=$2 order by revision_number desc limit 1`,
      [input.companyId, revision.document_id],
    )).rows[0];
    const responseEligible = revision.authorization_classification === "required_external_customer"
      && revision.document_type === "estimate" && latest?.id === revision.id && !terminal;
    const actions = ["view_revision", ...(responseEligible ? ["respond_revision"] : []),
      ...(revision.workorder_id ? ["customer_chat"] : [])];
    const inserted = (await client.query(
      `insert into customer_document_access_grants(
         company_id,location_id,document_id,revision_id,token_hash,token_hint,allowed_actions,
         workorder_id,issued_by_user_id,expires_at,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7::text[],$8,$9,$10,$11,$12) returning *`,
      [input.companyId, input.locationId, revision.document_id, revision.id, digest,
        rawToken.slice(-8), actions, actions.includes("customer_chat") ? revision.workorder_id : null,
        input.actorId, input.expiresAt, input.idempotencyKey, input.requestHash],
    )).rows[0];
    await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'grant_issued','staff',$6,$7::jsonb,$8,$9)`,
      [input.companyId, input.locationId, revision.document_id, revision.id, revision.content_hash,
        input.actorId, JSON.stringify({ grantId: inserted.id, allowedActions: actions }),
        input.idempotencyKey, input.requestHash],
    );
    return { grant: grantRow(inserted), rawToken, replayed: false };
  });
}

export async function recordCustomerDocumentResponse(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  if (!RESPONSE_TYPES.has(input.responseType)) throw domainError("CUSTOMER_DOCUMENT_RESPONSE_INVALID");
  const digest = tokenHash(input.rawToken);
  return transact(dependencies, async (client) => {
    const grant = (await client.query(
      "select * from customer_document_access_grants where token_hash=$1 for update",
      [digest],
    )).rows[0];
    if (!grant) throw domainError("CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE");
    if (grant.revoked_at || new Date(grant.expires_at).getTime() <= Date.now()
      || !grant.allowed_actions.includes("respond_revision")) {
      throw domainError("CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE");
    }
    const replay = await client.query(
      `select * from customer_document_events
        where company_id=$1 and access_grant_id=$2 and idempotency_key=$3 limit 1`,
      [grant.company_id, grant.id, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== input.requestHash) throw domainError("CUSTOMER_DOCUMENT_IDEMPOTENCY_CONFLICT");
      return { eventId: replay.rows[0].id, responseType: replay.rows[0].event_type, replayed: true };
    }
    const revision = (await client.query(
      `select revision.*,document.document_type,
          coalesce(auth_event.classification,draft.authorization_classification) as authorization_classification
         from customer_document_revisions revision
         join customer_documents document
           on document.company_id=revision.company_id and document.id=revision.document_id
         left join workorder_drafts draft on draft.company_id=document.company_id and draft.id=document.draft_id
         left join workorder_authorization_events auth_event
           on auth_event.company_id=document.company_id and auth_event.workorder_id=document.workorder_id
        where revision.company_id=$1 and revision.id=$2`,
      [grant.company_id, grant.revision_id],
    )).rows[0];
    const terminal = (await client.query(
      `select event_type from customer_document_events
        where company_id=$1 and revision_id=$2
          and event_type in ('accepted','declined','changes_requested','voided','superseded')
        order by created_at desc,id desc limit 1`,
      [grant.company_id, grant.revision_id],
    )).rows[0];
    if (terminal) throw domainError("CUSTOMER_DOCUMENT_REVISION_NOT_RESPONSE_ELIGIBLE");
    const latest = (await client.query(
      `select id from customer_document_revisions
        where company_id=$1 and document_id=$2 order by revision_number desc limit 1`,
      [grant.company_id, grant.document_id],
    )).rows[0];
    if (revision.document_type !== "estimate" || latest?.id !== grant.revision_id
      || revision.authorization_classification !== "required_external_customer") {
      throw domainError("CUSTOMER_DOCUMENT_REVISION_NOT_RESPONSE_ELIGIBLE");
    }
    const inserted = (await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         access_grant_id,displayed_amount,currency,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,'customer',$7,$8,$9,$10::jsonb,$11,$12) returning id,event_type`,
      [grant.company_id, grant.location_id, grant.document_id, grant.revision_id, revision.content_hash,
        input.responseType, grant.id, revision.total_amount, revision.currency,
        JSON.stringify({ customerName: input.customerName, note: input.note || "" }),
        input.idempotencyKey, input.requestHash],
    )).rows[0];
    await client.query(
      "update customer_document_access_grants set last_used_at=now() where company_id=$1 and id=$2",
      [grant.company_id, grant.id],
    );
    return { eventId: inserted.id, responseType: inserted.event_type, replayed: false };
  });
}

export async function voidCustomerDocumentRevision(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "void");
    const replay = await replayStaffEvent(client, input);
    if (replay) return { eventId: replay.id, replayed: true };
    const revision = (await client.query(
      `select revision.*,document.document_number,document.document_type,document.workorder_id
         from customer_document_revisions revision
         join customer_documents document
           on document.company_id=revision.company_id and document.id=revision.document_id
        where revision.company_id=$1 and revision.location_id=$2 and revision.id=$3
        for update of document,revision`,
      [input.companyId, input.locationId, input.revisionId],
    )).rows[0];
    if (!revision) throw domainError("CUSTOMER_DOCUMENT_REVISION_NOT_FOUND");
    if (revision.document_type === "estimate" && revision.workorder_id) {
      const invoiced = await client.query(
        `select invoice.id from customer_documents invoice
          join customer_document_revisions invoice_revision
            on invoice_revision.company_id=invoice.company_id and invoice_revision.document_id=invoice.id
         where invoice.company_id=$1 and invoice.workorder_id=$2 and invoice.document_type='invoice'
         limit 1`,
        [input.companyId, revision.workorder_id],
      );
      if (invoiced.rows[0]) throw domainError("CUSTOMER_DOCUMENT_REVISION_CLOSED");
    }
    const latest = (await client.query(
      `select id from customer_document_revisions
        where company_id=$1 and document_id=$2 order by revision_number desc limit 1`,
      [input.companyId, revision.document_id],
    )).rows[0];
    if (latest?.id !== revision.id) throw domainError("CUSTOMER_DOCUMENT_REVISION_CONFLICT");
    const inserted = (await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,displayed_amount,currency,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'voided','staff',$6,$7,$8,$9::jsonb,$10,$11) returning id`,
      [input.companyId, input.locationId, revision.document_id, revision.id, revision.content_hash,
        input.actorId, revision.total_amount, revision.currency, JSON.stringify({ reason: input.reason }),
        input.idempotencyKey, input.requestHash],
    )).rows[0];
    return { eventId: inserted.id, replayed: false };
  });
}

export async function revokeCustomerDocumentGrant(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "revoke-grant");
    const replay = await replayStaffEvent(client, input);
    if (replay) return { eventId: replay.id, replayed: true };
    const grant = (await client.query(
      `select grant_row.*,revision.content_hash,revision.total_amount,revision.currency
         from customer_document_access_grants grant_row
         join customer_document_revisions revision
           on revision.company_id=grant_row.company_id and revision.id=grant_row.revision_id
        where grant_row.company_id=$1 and grant_row.location_id=$2 and grant_row.id=$3 for update of grant_row`,
      [input.companyId, input.locationId, input.grantId],
    )).rows[0];
    if (!grant) throw domainError("CUSTOMER_DOCUMENT_GRANT_NOT_FOUND");
    if (grant.revoked_at) return { eventId: null, replayed: false, alreadyRevoked: true };
    await client.query(
      `update customer_document_access_grants
          set revoked_at=now(),revoked_by_user_id=$3,revocation_reason=$4
        where company_id=$1 and id=$2`,
      [input.companyId, grant.id, input.actorId, input.reason],
    );
    const inserted = (await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'grant_revoked','staff',$6,$7::jsonb,$8,$9) returning id`,
      [input.companyId, input.locationId, grant.document_id, grant.revision_id, grant.content_hash,
        input.actorId, JSON.stringify({ grantId: grant.id, reason: input.reason }),
        input.idempotencyKey, input.requestHash],
    )).rows[0];
    return { eventId: inserted.id, replayed: false, alreadyRevoked: false };
  });
}

export async function bindApprovedEstimateToWorkorder(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "bind-workorder");
    const replay = await replayStaffEvent(client, input);
    if (replay) return { eventId: replay.id, replayed: true };
    const document = (await client.query(
      `select * from customer_documents
        where company_id=$1 and location_id=$2 and id=$3 for update`,
      [input.companyId, input.locationId, input.documentId],
    )).rows[0];
    if (!document || !document.draft_id) throw domainError("CUSTOMER_DOCUMENT_NOT_FOUND");
    if (document.document_type !== "estimate") throw domainError("CUSTOMER_DOCUMENT_ESTIMATE_REQUIRED");
    if (document.workorder_id) {
      if (document.workorder_id !== input.workorderId) throw domainError("CUSTOMER_DOCUMENT_WORKORDER_CONFLICT");
      return { eventId: null, replayed: false, alreadyBound: true };
    }
    const draft = (await client.query(
      `select submitted_workorder_id from workorder_drafts
        where company_id=$1 and location_id=$2 and id=$3 for update`,
      [input.companyId, input.locationId, document.draft_id],
    )).rows[0];
    if (!draft || draft.submitted_workorder_id !== input.workorderId) {
      throw domainError("CUSTOMER_DOCUMENT_WORKORDER_CONFLICT");
    }
    await client.query(
      "update customer_documents set workorder_id=$3 where company_id=$1 and id=$2",
      [input.companyId, document.id, input.workorderId],
    );
    const revision = (await client.query(
      `select * from customer_document_revisions
        where company_id=$1 and document_id=$2 order by revision_number desc limit 1`,
      [input.companyId, document.id],
    )).rows[0];
    const accepted = (await client.query(
      `select id from customer_document_events
        where company_id=$1 and revision_id=$2 and event_type='accepted' limit 1`,
      [input.companyId, revision.id],
    )).rows[0];
    if (!accepted) throw domainError("CUSTOMER_DOCUMENT_APPROVAL_REQUIRED");
    const inserted = (await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'workorder_bound','staff',$6,$7::jsonb,$8,$9) returning id`,
      [input.companyId, input.locationId, document.id, revision.id, revision.content_hash,
        input.actorId, JSON.stringify({ workorderId: input.workorderId }), input.idempotencyKey, input.requestHash],
    )).rows[0];
    return { eventId: inserted.id, replayed: false, alreadyBound: false };
  });
}

export async function bindInformationalEstimateToWorkorder(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "bind-informational-workorder");
    const document = (await client.query(
      `select * from customer_documents where company_id=$1 and location_id=$2 and id=$3 for update`,
      [input.companyId, input.locationId, input.documentId],
    )).rows[0];
    if (!document || document.document_type !== "estimate" || document.draft_id !== input.draftId) {
      throw domainError("CUSTOMER_DOCUMENT_NOT_FOUND");
    }
    if (document.workorder_id) {
      if (document.workorder_id !== input.workorderId) throw domainError("CUSTOMER_DOCUMENT_WORKORDER_CONFLICT");
      return { alreadyBound: true };
    }
    const draft = (await client.query(
      `select submitted_workorder_id,authorization_classification from workorder_drafts
        where company_id=$1 and location_id=$2 and id=$3 for update`,
      [input.companyId, input.locationId, input.draftId],
    )).rows[0];
    if (draft?.submitted_workorder_id !== input.workorderId || draft.authorization_classification !== "approval_not_required") {
      throw domainError("CUSTOMER_DOCUMENT_WORKORDER_CONFLICT");
    }
    const revision = (await client.query(
      `select * from customer_document_revisions where company_id=$1 and document_id=$2
        order by revision_number desc limit 1`,
      [input.companyId, document.id],
    )).rows[0];
    if (!revision || revision.id !== input.revisionId) throw domainError("CUSTOMER_DOCUMENT_REVISION_CONFLICT");
    await client.query("update customer_documents set workorder_id=$3 where company_id=$1 and id=$2",
      [input.companyId, document.id, input.workorderId]);
    await client.query(
      `insert into customer_document_events(company_id,location_id,document_id,revision_id,revision_hash,
        event_type,actor_type,actor_user_id,metadata,idempotency_key,request_hash)
       values($1,$2,$3,$4,$5,'workorder_bound','staff',$6,$7::jsonb,$8,$9)`,
      [input.companyId, input.locationId, document.id, revision.id, revision.content_hash,
        input.actorId, JSON.stringify({ workorderId: input.workorderId, approvalRequired: false }),
        input.idempotencyKey, input.requestHash],
    );
    return { alreadyBound: false };
  });
}

export async function activateApprovedEstimate(input, submitDraft, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  return transact(dependencies, async (client) => {
    await commandLock(client, input, "activate");
    const replay = await replayStaffEvent(client, input);
    if (replay) {
      return { eventId: replay.id, workorderId: replay.metadata?.workorderId, replayed: true };
    }
    const revision = (await client.query(
      `select revision.*,document.draft_id,document.workorder_id,document.document_type
         from customer_document_revisions revision
         join customer_documents document
           on document.company_id=revision.company_id and document.id=revision.document_id
        where revision.company_id=$1 and revision.location_id=$2 and revision.id=$3
        for update of document,revision`,
      [input.companyId, input.locationId, input.revisionId],
    )).rows[0];
    if (!revision || revision.document_type !== "estimate" || !revision.draft_id) {
      throw domainError("CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY");
    }
    const source = revision.snapshot?.sourceEvidence;
    if (source?.kind !== "draft" || source.id !== revision.draft_id
      || Number(source.version) !== Number(input.expectedDraftVersion)
      || !HASH_PATTERN.test(String(source.pricingFingerprint || ""))) {
      throw domainError("CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY");
    }
    const latest = (await client.query(
      `select id from customer_document_revisions
        where company_id=$1 and document_id=$2 order by revision_number desc limit 1`,
      [input.companyId, revision.document_id],
    )).rows[0];
    const decision = (await client.query(
      `select event_type from customer_document_events
        where company_id=$1 and revision_id=$2
          and event_type in ('accepted','declined','changes_requested','voided','superseded')
        order by created_at desc,id desc`,
      [input.companyId, revision.id],
    )).rows;
    if (latest?.id !== revision.id || decision.some((event) => event.event_type !== "accepted")
      || !decision.some((event) => event.event_type === "accepted")) {
      throw domainError("CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY");
    }
    const submitted = await submitDraft({
      client,
      draftId: revision.draft_id,
      draftVersion: input.expectedDraftVersion,
      pricingFingerprint: revision.snapshot?.sourceEvidence?.pricingFingerprint,
      acceptedEstimateRevisionId: revision.id,
    });
    if (!submitted?.workorderId) throw domainError("CUSTOMER_DOCUMENT_ACTIVATION_NOT_READY");
    if (revision.workorder_id && revision.workorder_id !== submitted.workorderId) {
      throw domainError("CUSTOMER_DOCUMENT_WORKORDER_CONFLICT");
    }
    if (!revision.workorder_id) {
      await client.query(
        "update customer_documents set workorder_id=$3 where company_id=$1 and id=$2",
        [input.companyId, revision.document_id, submitted.workorderId],
      );
    }
    const inserted = (await client.query(
      `insert into customer_document_events(
         company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
         actor_user_id,metadata,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,'workorder_bound','staff',$6,$7::jsonb,$8,$9) returning id`,
      [input.companyId, input.locationId, revision.document_id, revision.id, revision.content_hash,
        input.actorId, JSON.stringify({
          workorderId: submitted.workorderId,
          activationPolicy: input.activationPolicy,
          acceptedRevisionHash: revision.content_hash,
        }), input.idempotencyKey, input.requestHash],
    )).rows[0];
    return { eventId: inserted.id, workorderId: submitted.workorderId, replayed: false };
  });
}

export async function resolveCustomerDocumentGrant(input, dependencies = {}) {
  const digest = tokenHash(input.rawToken);
  if (!GRANT_ACTIONS.has(input.capability || "view_revision")) return null;
  const run = dependencies.query || query;
  const result = await run(
    `select revision.*,document.document_type,document.document_number,
            grant_row.id as grant_id,grant_row.revision_id as grant_revision_id,
            grant_row.token_hint,grant_row.allowed_actions,
            grant_row.workorder_id as grant_workorder_id,grant_row.issued_at as grant_issued_at,
            grant_row.expires_at as grant_expires_at,grant_row.revoked_at as grant_revoked_at,
            grant_row.last_used_at as grant_last_used_at
       from customer_document_access_grants grant_row
       join customer_document_revisions revision
         on revision.company_id=grant_row.company_id and revision.id=grant_row.revision_id
       join customer_documents document
         on document.company_id=grant_row.company_id and document.id=grant_row.document_id
      where grant_row.token_hash=$1 and grant_row.revoked_at is null and grant_row.expires_at>now()
        and $2=any(grant_row.allowed_actions)
      limit 1`,
    [digest, input.capability || "view_revision"],
  );
  if (!result.rows[0]) return null;
  return { grant: grantRow(result.rows[0]), revision: revisionRow(result.rows[0]) };
}

export async function viewCustomerDocumentGrant(input, dependencies = {}) {
  requireHash(input.requestHash, "requestHash");
  const digest = tokenHash(input.rawToken);
  return transact(dependencies, async (client) => {
    const grant = (await client.query(
      "select * from customer_document_access_grants where token_hash=$1 for update",
      [digest],
    )).rows[0];
    if (!grant || grant.revoked_at || new Date(grant.expires_at).getTime() <= Date.now()
      || !grant.allowed_actions.includes("view_revision")) {
      throw domainError("CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE");
    }
    const replay = await client.query(
      `select * from customer_document_events
        where company_id=$1 and access_grant_id=$2 and revision_id=$3 and event_type='viewed'
        order by created_at,id limit 1`,
      [grant.company_id, grant.id, grant.revision_id],
    );
    const revision = (await client.query(
      `select revision.*,document.document_type,document.document_number,
              coalesce(auth_event.classification,draft.authorization_classification) as authorization_classification,
              grant_row.id as grant_id,grant_row.revision_id as grant_revision_id,
              grant_row.token_hint,grant_row.allowed_actions,
              grant_row.workorder_id as grant_workorder_id,grant_row.issued_at as grant_issued_at,
              grant_row.expires_at as grant_expires_at,grant_row.revoked_at as grant_revoked_at,
              grant_row.last_used_at as grant_last_used_at
         from customer_document_access_grants grant_row
         join customer_document_revisions revision
           on revision.company_id=grant_row.company_id and revision.id=grant_row.revision_id
         join customer_documents document
           on document.company_id=grant_row.company_id and document.id=grant_row.document_id
         left join workorder_drafts draft on draft.company_id=document.company_id and draft.id=document.draft_id
         left join workorder_authorization_events auth_event
           on auth_event.company_id=document.company_id and auth_event.workorder_id=document.workorder_id
        where grant_row.company_id=$1 and grant_row.id=$2`,
      [grant.company_id, grant.id],
    )).rows[0];
    if (!revision) throw domainError("CUSTOMER_DOCUMENT_GRANT_UNAVAILABLE");
    const response = (await client.query(
      `select event_type,created_at,metadata
         from customer_document_events
        where company_id=$1 and revision_id=$2
          and event_type in ('accepted','declined','changes_requested','voided','superseded')
        order by created_at desc,id desc limit 1`,
      [grant.company_id, grant.revision_id],
    )).rows[0] || null;
    if (!replay.rows[0]) {
      await client.query(
        `insert into customer_document_events(
           company_id,location_id,document_id,revision_id,revision_hash,event_type,actor_type,
           access_grant_id,displayed_amount,currency,idempotency_key,request_hash
         ) values($1,$2,$3,$4,$5,'viewed','customer',$6,$7,$8,$9,$10)`,
        [grant.company_id, grant.location_id, grant.document_id, grant.revision_id,
          revision.content_hash, grant.id, revision.total_amount, revision.currency,
          `first-view:${grant.id}:${grant.revision_id}`,
          canonicalFinancialHash({ eventType: "viewed", grantId: grant.id, revisionId: grant.revision_id })],
      );
    }
    await client.query(
      "update customer_document_access_grants set last_used_at=now() where company_id=$1 and id=$2",
      [grant.company_id, grant.id],
    );
    return {
      grant: grantRow(revision), revision: revisionRow(revision), replayed: Boolean(replay.rows[0]),
      response: revision.document_type === "invoice"
        || revision.authorization_classification === "approval_not_required" ? {
        status: "not_applicable", respondedAt: null, customerName: null,
      } : response ? {
        status: response.event_type,
        respondedAt: response.created_at,
        customerName: response.metadata?.customerName || null,
      } : { status: "pending", respondedAt: null, customerName: null },
      approvalRequired: revision.authorization_classification === "required_external_customer",
      responseEligible: revision.document_type === "estimate"
        && revision.authorization_classification === "required_external_customer"
        && grant.allowed_actions.includes("respond_revision") && !response,
    };
  });
}

export async function getStaffCustomerDocumentRevision(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select revision.*,document.document_type,document.document_number,
            revision.id=(select latest.id from customer_document_revisions latest
              where latest.company_id=revision.company_id and latest.document_id=revision.document_id
              order by latest.revision_number desc limit 1) as is_latest,
            response.event_type as response_event_type,response.created_at as response_created_at,
            response.metadata as response_metadata
       from customer_document_revisions revision
       join customer_documents document
         on document.company_id=revision.company_id and document.id=revision.document_id
       left join lateral (
         select event.event_type,event.created_at,event.metadata
           from customer_document_events event
          where event.company_id=revision.company_id and event.revision_id=revision.id
            and event.event_type in ('accepted','declined','changes_requested','voided','superseded')
          order by event.created_at desc,event.id desc limit 1
       ) response on true
      where revision.id=$1 and revision.company_id=any($2::uuid[])
        and ($3::boolean or revision.location_id=any($4::uuid[]))
      limit 1`,
    [input.revisionId, input.companyIds, input.isAdmin, input.locationIds],
  );
  return revisionRow(result.rows[0]);
}

export async function getStaffCurrentEstimateByDraft(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select revision.*,document.document_type,document.document_number,document.draft_id,document.workorder_id,
            true as is_latest,response.event_type as response_event_type,
            response.created_at as response_created_at,response.metadata as response_metadata
       from customer_documents document
       join lateral (
         select candidate.* from customer_document_revisions candidate
          where candidate.company_id=document.company_id and candidate.document_id=document.id
          order by candidate.revision_number desc limit 1
       ) revision on true
       left join lateral (
         select event.event_type,event.created_at,event.metadata
           from customer_document_events event
          where event.company_id=revision.company_id and event.revision_id=revision.id
            and event.event_type in ('accepted','declined','changes_requested','voided','superseded')
          order by event.created_at desc,event.id desc limit 1
       ) response on true
      where document.company_id=$1 and document.location_id=$2 and document.draft_id=$3
        and document.document_type='estimate'
      limit 1`,
    [input.companyId, input.locationId, input.draftId],
  );
  return revisionRow(result.rows[0]);
}

export async function getCurrentEstimateByDraftForUpdate(input, dependencies = {}) {
  const client = dependencies.client;
  if (!client) throw domainError("CUSTOMER_DOCUMENT_TRANSACTION_REQUIRED");
  const document = (await client.query(
    `select * from customer_documents
      where company_id=$1 and location_id=$2 and draft_id=$3 and document_type='estimate'
      order by created_at,id limit 1 for update`,
    [input.companyId, input.locationId, input.draftId],
  )).rows[0];
  if (!document) return null;
  const revision = (await client.query(
    `select revision.*,document.document_type,document.document_number,document.draft_id,document.workorder_id
       from customer_document_revisions revision
       join customer_documents document
         on document.company_id=revision.company_id and document.id=revision.document_id
      where revision.company_id=$1 and revision.document_id=$2
      order by revision.revision_number desc limit 1`,
    [input.companyId, document.id],
  )).rows[0];
  return revisionRow(revision);
}

export async function getCurrentAcceptedEstimateForWorkorder(input, dependencies = {}) {
  const run = dependencies.client?.query?.bind(dependencies.client) || dependencies.query || query;
  const result = await run(
    `select revision.*,document.document_type,document.document_number,
            true as is_latest,'accepted'::text as response_event_type,
            accepted.created_at as response_created_at,accepted.metadata as response_metadata,
            exists (
              select 1 from workorder_authorization_events auth_event
               where auth_event.company_id=document.company_id
                 and auth_event.workorder_id=document.workorder_id
                 and auth_event.classification='required_external_customer'
                 and auth_event.accepted_estimate_revision_id=revision.id
            ) as activation_authorized
       from customer_documents document
       join lateral (
         select candidate.* from customer_document_revisions candidate
          where candidate.company_id=document.company_id and candidate.document_id=document.id
          order by candidate.revision_number desc limit 1
       ) revision on true
       join customer_document_events accepted
         on accepted.company_id=revision.company_id and accepted.revision_id=revision.id
        and accepted.event_type='accepted'
      where document.company_id=$1 and document.location_id=$2
        and document.workorder_id=$3 and document.document_type='estimate'
        and not exists (
          select 1 from customer_document_events terminal
           where terminal.company_id=revision.company_id and terminal.revision_id=revision.id
             and terminal.event_type in ('declined','changes_requested','voided','superseded')
        )
      order by revision.issued_at desc,revision.id desc limit 1
      for update of document,revision`,
    [input.companyId, input.locationId, input.workorderId],
  );
  return revisionRow(result.rows[0]);
}

export async function getCustomerDocumentSummaryByWorkorder(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select document.id document_id,document.document_type,document.document_number,
            document.draft_id,revision.*,response.event_type response_event_type,
            response.created_at response_created_at,response.metadata response_metadata,true is_latest
       from customer_documents document
       join lateral (
         select candidate.* from customer_document_revisions candidate
          where candidate.company_id=document.company_id and candidate.document_id=document.id
          order by candidate.revision_number desc limit 1
       ) revision on true
       left join lateral (
         select event.event_type,event.created_at,event.metadata
           from customer_document_events event
          where event.company_id=revision.company_id and event.revision_id=revision.id
            and event.event_type in ('accepted','declined','changes_requested','voided','superseded')
          order by event.created_at desc,event.id desc limit 1
       ) response on true
      where document.company_id=$1 and document.location_id=$2 and document.workorder_id=$3
      order by document.document_type,revision.issued_at desc,revision.id desc`,
    [input.companyId, input.locationId, input.workorderId],
  );
  const latestByType = new Map();
  for (const row of result.rows) if (!latestByType.has(row.document_type)) latestByType.set(row.document_type, revisionRow(row));
  return { estimate: latestByType.get("estimate") || null, invoice: latestByType.get("invoice") || null };
}

export async function getStaffCustomerDocument(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select document.*,revision.id as revision_id,revision.revision_number,revision.content_hash,
            revision.total_amount,revision.currency,revision.issued_at
       from customer_documents document
       left join lateral (
         select * from customer_document_revisions candidate
         where candidate.company_id=document.company_id and candidate.document_id=document.id
         order by candidate.revision_number desc limit 1
       ) revision on true
      where document.id=$1 and document.company_id=any($2::uuid[])
        and ($3::boolean or document.location_id=any($4::uuid[]))
      limit 1`,
    [input.documentId, input.companyIds, input.isAdmin, input.locationIds],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    draftId: row.draft_id || null,
    workorderId: row.workorder_id || null,
    documentType: row.document_type,
    documentNumber: row.document_number,
    latestRevision: row.revision_id ? {
      id: row.revision_id,
      revisionNumber: Number(row.revision_number),
      contentHash: row.content_hash,
      totalAmount: row.total_amount,
      currency: row.currency,
      issuedAt: row.issued_at,
    } : null,
  };
}

export async function listStaffCustomerDocuments(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `select document.*,revision.id as revision_id,revision.revision_number,revision.content_hash,
            revision.total_amount,revision.currency,revision.issued_at
       from customer_documents document
       left join lateral (
         select * from customer_document_revisions candidate
         where candidate.company_id=document.company_id and candidate.document_id=document.id
         order by candidate.revision_number desc limit 1
       ) revision on true
      where document.company_id=any($1::uuid[])
        and ($2::boolean or document.location_id=any($3::uuid[]))
        and ($4::uuid is null or document.workorder_id=$4)
        and ($5::uuid is null or document.draft_id=$5)
      order by document.created_at desc,document.id desc limit $6`,
    [input.companyIds, input.isAdmin, input.locationIds, input.workorderId || null,
      input.draftId || null, Math.min(Math.max(Number(input.limit) || 50, 1), 100)],
  );
  return result.rows.map((row) => ({
    id: row.id,
    companyId: row.company_id,
    locationId: row.location_id,
    draftId: row.draft_id || null,
    workorderId: row.workorder_id || null,
    documentType: row.document_type,
    documentNumber: row.document_number,
    latestRevision: row.revision_id ? {
      id: row.revision_id,
      revisionNumber: Number(row.revision_number),
      contentHash: row.content_hash,
      totalAmount: row.total_amount,
      currency: row.currency,
      issuedAt: row.issued_at,
    } : null,
  }));
}

// This is deliberately an operational support projection, not an accounting
// ledger. Totals remain grouped by currency and document state so callers never
// accidentally add incomparable monetary values.
export async function readCustomerDocumentReport(input, dependencies = {}) {
  const run = dependencies.query || query;
  const result = await run(
    `with latest_revisions as (
       select document.id as document_id,document.document_type,document.document_number,
              document.location_id,revision.id as revision_id,revision.currency,
              revision.total_amount,revision.issued_at,
              coalesce(response.event_type,
                case when document.document_type='invoice' then 'issued' else 'pending' end) as state
         from customer_documents document
         join lateral (
           select candidate.* from customer_document_revisions candidate
            where candidate.company_id=document.company_id and candidate.document_id=document.id
            order by candidate.revision_number desc limit 1
         ) revision on true
         left join lateral (
           select event.event_type from customer_document_events event
            where event.company_id=document.company_id and event.revision_id=revision.id
              and event.event_type in ('accepted','declined','changes_requested','voided','superseded')
            order by event.created_at desc,event.id desc limit 1
         ) response on true
        where document.company_id=$1 and document.location_id=$2
          and revision.issued_at >= $3::timestamptz and revision.issued_at < $4::timestamptz
     ), document_groups as (
       select document_type,state,currency,count(*)::int as count,
              sum(total_amount)::text as total_amount
         from latest_revisions
        group by document_type,state,currency
     ), support_grants as (
       select grant_row.id,grant_row.token_hint,grant_row.document_id,grant_row.revision_id,
              document.document_type,document.document_number,grant_row.issued_at,
              grant_row.expires_at,grant_row.revoked_at,grant_row.last_used_at,
              case when grant_row.revoked_at is not null then 'revoked'
                   when grant_row.expires_at <= now() then 'expired'
                   when grant_row.expires_at <= now() + interval '7 days' then 'expiring'
                   else 'active' end as state
         from customer_document_access_grants grant_row
         join customer_documents document
           on document.company_id=grant_row.company_id and document.id=grant_row.document_id
        where grant_row.company_id=$1 and grant_row.location_id=$2
          and (grant_row.revoked_at is not null or grant_row.expires_at <= now() + interval '7 days')
        order by coalesce(grant_row.revoked_at, grant_row.expires_at) desc,grant_row.id desc
        limit $5
     )
     select coalesce((select jsonb_agg(jsonb_build_object(
              'documentType',document_type,'state',state,'currency',currency,
              'count',count,'totalAmount',total_amount
            ) order by document_type,state,currency) from document_groups),'[]'::jsonb) as documents,
            coalesce((select jsonb_agg(jsonb_build_object(
              'id',id,'tokenHint',token_hint,'documentId',document_id,'revisionId',revision_id,
              'documentType',document_type,'documentNumber',document_number,'state',state,
              'issuedAt',issued_at,'expiresAt',expires_at,'revokedAt',revoked_at,'lastUsedAt',last_used_at
            ) order by coalesce(revoked_at,expires_at) desc,id desc) from support_grants),'[]'::jsonb) as grants`,
    [input.companyId, input.locationId, input.startAt, input.endAt, input.grantLimit],
  );
  const row = result.rows[0] || {};
  return { documents: row.documents || [], grants: row.grants || [] };
}

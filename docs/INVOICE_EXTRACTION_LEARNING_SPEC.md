# Spec: Learning Invoice Extraction — Vertical Slice 1

**Author:** Codex with product direction from the user
**Date:** 2026-08-24
**Status:** Approved
**Approval basis:** The user explicitly requested a plan followed by execution in the same request.
**Reviewers:** Product owner; engineering adversarial review required before completion
**Related:** `docs/INVENTORY_ODOO_LIVING_RECORD.md`, `docs/DATABASE.md`

## Context

The application has structured OpenAI Responses API patterns for part identification, company-scoped parts catalog memory, office authorization, and Odoo inventory projections. It has no invoice extraction workflow, no durable correction corpus, and no controlled mechanism for learning from reviewed invoices. Invoice data must therefore be re-entered manually, while a naive AI implementation would repeat mistakes or silently turn uncertain text into inventory truth.

The attached product concept defines three memory layers: episodic memory records what happened, semantic memory records what is true, and procedural memory records what works. In this module, those become append-only human corrections, approved tenant/vendor facts, and versioned extraction playbooks. Learning is retrieval and governed promotion, not uncontrolled online model training.

This vertical slice ends at a reviewed invoice draft and an explicitly approved, encrypted training example. It deliberately does not create an Odoo receipt or mutate inventory. The hosted model's structured prediction is weak supervision; the human-reviewed draft is the gold label. The system records observable inputs, outputs, corrections, model/version, and token usage, but it neither receives nor claims to retain a provider's hidden chain-of-thought.

The resulting corpus is the product asset used to evaluate and eventually train a local extractor. Model training and automatic model promotion remain separate gated phases because a useful model requires enough diverse, reviewed invoices and an untouched evaluation set.

## Functional Requirements

- FR-1: The system MUST allow an authenticated office or admin user to submit one PNG, JPEG, WebP, or PDF invoice of at most 10 MiB for a location they can access.
- FR-2: The system MUST derive company ownership from the authorized location and MUST ignore client-supplied company identity.
- FR-3: The system MUST send the document to the configured extraction provider with `store: false` and a strict structured-output schema.
- FR-4: The extracted draft MUST contain vendor, invoice number/date, purchase-order number, currency, subtotal, tax, shipping, total, and zero or more line items.
- FR-5: Every extracted scalar and every line item MUST include a confidence score from 0 through 100 and a short evidence string.
- FR-6: The system MUST mark a draft `needs_review` when any required field has confidence below 90, any line has confidence below 90, totals do not reconcile within 0.02 currency units, or the provider reports uncertainty.
- FR-7: Extraction MUST NOT create or modify products, vendors, receipts, serials, quantities, accounting entries, or Odoo records.
- FR-8: The system MUST persist an immutable document hash, provider/model/prompt versions, extracted draft, status, and audit timestamps. It MUST persist source bytes only as authenticated encryption, never as a base64 data URL or plaintext database value.
- FR-9: An authorized office or admin user MUST be able to retrieve a run only through its tenant and location scope.
- FR-10: An authorized reviewer MUST be able to submit a complete corrected draft with the expected run version and an idempotency key.
- FR-11: A successful review MUST atomically store the reviewed draft, increment the version, record reviewer identity, and create one episodic correction event for every changed field.
- FR-12: Reusing the same review idempotency key for the same run MUST return the original reviewed result without duplicating corrections.
- FR-13: Reviewing with a stale expected version MUST return conflict and MUST NOT overwrite the accepted review.
- FR-14: Reviewed corrections MUST create or reinforce tenant- and vendor-scoped semantic fact candidates; a fact MUST NOT influence extraction until the reviewer explicitly opts to approve learning and no contradictory approved fact exists.
- FR-15: The extraction prompt MUST include at most 20 approved semantic facts and at most 5 active procedural playbooks scoped to the same company and matching vendor when known.
- FR-16: Procedural playbooks MUST be immutable by version; activation of a later version MUST NOT rewrite historical extraction records.
- FR-17: Provider failure, timeout, refusal, or invalid structured output MUST leave a durable failed run with a safe error code and retryable flag, without storing raw provider error bodies.
- FR-18: The office UI MUST provide upload, progress, an in-session source preview beside the draft, extracted-field editing, line editing, confidence visibility, explicit approval, and clear success/error states.
- FR-18a: Learning approval MUST default off and require an explicit reviewer opt-in on each draft.
- FR-19: The UI MUST require a selected accessible location and supported file before enabling extraction.
- FR-20: The UI MUST label the result as a draft and state that approving it does not change inventory.
- FR-21: Before invoking the provider, the system MUST require a configured invoice-document encryption key and atomically persist an AES-256-GCM encrypted source whose authenticated data binds company, run, hash, and MIME type.
- FR-22: The provider adapter MUST return the structured prediction plus observable response ID and token usage when available; the application MUST NOT request, expose, or represent hidden reasoning as training data.
- FR-23: A review with learning approval MUST atomically create exactly one versioned training example containing the immutable provider prediction, human-reviewed gold draft, correction/quality metrics, source lineage, extractor identity, and reviewer identity.
- FR-24: A review without learning approval MUST mark its source excluded from model training. Learning approval MUST be captured in the idempotent review request and MUST NOT be inferred from ordinary approval.
- FR-25: An authorized office/admin user MUST be able to retrieve the decrypted source for an accessible run through a no-store, same-origin binary response; every successful source read MUST create an access-audit event.
- FR-26: Encrypted sources MUST have a configured retention deadline. Training eligibility and source retention MUST be independently represented so exclusion from training does not imply immediate destruction of an operational review record.

## Non-Functional Requirements

- NFR-S1: All routes MUST use existing same-origin, session, office/admin permission, company, and location controls.
- NFR-S2: Cross-company run lookup MUST respond as not found and return no invoice metadata.
- NFR-S3: Document data MUST be length-bounded before decoding; decoded byte count, declared MIME, data-URL MIME, and file signature MUST agree.
- NFR-S4: Logs and API errors MUST NOT contain document bytes, full provider bodies, API keys, or extracted invoice content.
- NFR-S5: Extraction requests MUST be rate-limited to 10 per user per minute.
- NFR-S6: Missing, malformed, or wrong document-encryption configuration MUST fail closed before provider invocation or source persistence.
- NFR-S7: Authenticated decryption MUST fail on ciphertext, tag, metadata, company, run, hash, or MIME tampering and MUST return no plaintext.
- NFR-S8: Source responses MUST set `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, and a restrictive content security policy.
- NFR-R1: Review persistence MUST be one database transaction with optimistic locking and idempotency.
- NFR-R2: Provider timeout MUST be 60 seconds or less and MUST NOT be reported as a successful empty extraction.
- NFR-P1: Schema validation and learning-context preparation SHOULD complete in under 100 ms p95 excluding database and provider latency for 100 lines and 25 memory items.
- NFR-P2: Tenant/run, tenant/document-hash, correction/run, and active-memory retrieval MUST have supporting indexes.
- NFR-SC1: Extraction runs and events MUST be append-oriented and paginatable; provider execution MUST remain behind an adapter so it can move to a worker without changing domain contracts.
- NFR-A1: Upload and review controls MUST be keyboard-operable and have programmatic labels.
- NFR-A2: Busy, error, low-confidence, and success messages MUST be exposed through `role=status` or `role=alert` without color as the only signal.
- NFR-A3: The review layout MUST not overflow horizontally at 390×844 or 430×932.
- NFR-O1: Every run MUST record prompt version, model, duration, status, and review outcome for later quality evaluation.
- NFR-O2: Every run SHOULD record provider response ID, input tokens, output tokens, and reasoning tokens when supplied; absence of provider usage MUST remain explicit rather than estimated.
- NFR-O3: Training examples MUST be queryable by tenant, eligibility, extractor version, vendor key, and label version without decrypting every source document.

## Acceptance Criteria

### AC-1: Extract supported invoice (FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-7, FR-8, NFR-S1, NFR-S3)
Given an office user has access to a location and a valid supported invoice under 10 MiB
When they submit the invoice for extraction
Then the API returns a persisted schema-valid draft with run ID, version, status, confidence evidence, model, and prompt version
And no inventory or Odoo mutation is invoked

### AC-2: Reject invalid document (FR-1, NFR-S3)
Given an authenticated office user
When they submit an oversized, unsupported, malformed, or signature-mismatched document
Then the API returns 400 or 413 with a safe validation error
And the provider is not called

### AC-3: Preserve uncertainty (FR-5, FR-6)
Given a provider result with one required field at confidence 89
When the result is normalized
Then the run status is `needs_review`
And the low-confidence field remains visible with its evidence

### AC-4: Provider failure is durable (FR-17, NFR-R2, NFR-S4)
Given the provider times out, refuses, or returns invalid structured output
When extraction runs
Then the API returns a safe retryable or non-retryable error
And the failed run records only a bounded error code, not raw document or provider content

### AC-5: Approve reviewed draft (FR-10–FR-11, NFR-R1)
Given an extracted run at version 1 in the actor's tenant
When an authorized reviewer submits a complete corrected draft with expected version 1
Then the review is stored atomically at version 2
And one episodic event exists for every changed field

### AC-6: Idempotent review (FR-12, NFR-R1)
Given a review succeeded with idempotency key `review-1`
When the identical run and key are submitted again
Then the original version-2 result is returned
And no additional correction or semantic evidence is written

### AC-7: Concurrent stale review (FR-13, NFR-R1)
Given two reviewers load version 1
When both submit different reviews for expected version 1
Then exactly one succeeds
And the other receives 409 conflict without overwriting the winner

### AC-8: Tenant isolation (FR-2, FR-9, NFR-S1, NFR-S2)
Given a run belongs to company A
When an actor scoped only to company B requests or reviews its ID
Then the API returns not found or forbidden without invoice metadata

### AC-9: Governed learning (FR-14–FR-16)
Given repeated reviewed corrections create a semantic candidate
When a later invoice is extracted before that candidate is approved
Then the candidate is absent from provider context
And approved facts plus active playbooks from the same tenant are included within configured limits

### AC-10: Accessible review UX (FR-18, FR-19, FR-20, NFR-A1, NFR-A2, NFR-A3)
Given an office user opens the invoice workspace on desktop or a 390-pixel phone
When they upload, review, encounter an error, and approve a draft using keyboard controls
Then controls have labels, state changes are announced, low confidence has text/icon treatment, and no horizontal page overflow occurs

### AC-11: Local preparation budget (FR-15, NFR-P1)
Given a 100-line draft and 25 memory items
When validation, reconciliation, and prompt-context construction run 1,000 times
Then p95 local execution is under 100 ms in the test environment

### AC-12: Encrypted source capture (FR-8, FR-21, FR-26, NFR-S6, NFR-S7)
Given document encryption is correctly configured
When an authorized user submits a valid invoice
Then the source is persisted with ciphertext, IV, authentication tag, key version, hash, and retention deadline before provider execution
And neither the base64 request nor plaintext source bytes are present in stored rows or logs
And missing configuration prevents the provider call and returns a safe 503

### AC-13: Observable provider supervision (FR-22, NFR-O2)
Given the provider returns a structured prediction and token usage
When extraction completes
Then response ID and available token counts are stored with the run
And no hidden reasoning or raw provider body is stored

### AC-14: Idempotent gold training example (FR-23, FR-24)
Given an extracted run has an encrypted source
When a reviewer explicitly approves learning and submits a corrected draft
Then the review, correction events, learning facts, source eligibility, and one gold training example commit atomically
And replay creates no duplicate example
And the same review without learning approval creates no eligible training example

### AC-15: Secure restored preview (FR-25, NFR-S1, NFR-S2, NFR-S8)
Given an office/admin user refreshes an accessible run
When the UI requests its source
Then the source is decrypted only after tenant/location authorization, returned no-store with safe content headers, and the access is audited
And another tenant or mechanic receives no document bytes or metadata

## Edge Cases and Error Scenarios

- EC-1: Empty file or invalid base64 → 400; provider not called.
- EC-2: Extension disagrees with MIME or magic bytes → 400; provider not called.
- EC-3: Password-protected or unreadable PDF → failed run with `document_unreadable`; no empty draft.
- EC-4: Duplicate document hash with a different idempotency key → create a new attempt linked by hash; never assume it is the same invoice transaction.
- EC-5: Duplicate invoice number from the same vendor → warn in the draft; do not block or mutate accounting.
- EC-6: Multi-page invoice → provider receives the PDF as a file input; all pages may contribute evidence.
- EC-7: Credit memo or negative line → preserve signed amounts and mark document type; do not convert to a receipt.
- EC-8: Handwritten, rotated, blurry, or cropped input → lower confidence and require review.
- EC-9: Currency absent or conflicting → use `UNKNOWN`, require review, and never infer from company locale alone.
- EC-10: Sum of line extensions differs from subtotal/total beyond tolerance → require review with reconciliation warning.
- EC-11: Provider 429/5xx/timeout → safe retryable failure; user can retry explicitly.
- EC-12: Provider 401 → configuration failure; no key or provider body exposed.
- EC-13: Database failure after provider response → request fails; no success is shown; retry may create a new attempt using the document hash.
- EC-14: Review contains zero lines → allowed only when explicitly confirmed as a non-item invoice; otherwise validation fails.
- EC-15: Reviewer removes or changes a line → correction paths use stable extracted line IDs, not array positions alone.
- EC-16: Vendor name changes during review → semantic candidates are scoped using normalized reviewed vendor, while the event preserves original prediction.
- EC-17: Contradictory corrections → candidate evidence and contradiction counts update; candidate does not auto-approve.
- EC-18: During the upload session the reviewer can compare the source beside the draft; after refresh the UI restores it from the authorized no-store source endpoint.
- EC-19: A manually added line without either a part number or description, or with a missing/zero quantity → review validation fails with a field-safe message.
- EC-20: Encryption key missing or malformed → 503 before provider call; no run or source residue.
- EC-21: Ciphertext or authenticated metadata tampered → safe source-unavailable error; no partial plaintext response.
- EC-22: Learning-approved review replay → original reviewed result and existing example; no duplicate corpus row.
- EC-23: Source reaches retention deadline → encrypted payload is erased by the retention process while non-sensitive lineage and deletion audit remain.

## API Contracts

### `POST /api/office/invoice-extractions`

```ts
interface ExtractInvoiceRequest {
  locationId: string;       // UUID in actor scope
  fileName: string;         // 1..180 safe display characters
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  dataUrl: string;          // matching MIME, base64, decoded <= 10 MiB
  idempotencyKey: string;   // 8..120 characters
}

interface ExtractionRunResponse {
  run: {
    id: string;
    locationId: string;
    fileName: string;
    status: "completed" | "needs_review" | "failed" | "reviewed";
    version: number;
    draft: InvoiceDraft | null;
    model: string;
    promptVersion: string;
    errorCode: string | null;
    retryable: boolean;
    createdAt: string;
    reviewedAt: string | null;
  };
}
```

Success: `201`. Idempotent replay: `200`. Errors: `400`, `403`, `413`, `429`, `502`, `503`.

### `GET /api/office/invoice-extractions/:runId`

Success: `200 ExtractionRunResponse`. Foreign/missing run: `404`.

### `GET /api/office/invoice-extractions/:runId/source`

Success: `200` binary source with original allowlisted MIME and no-store security headers. Foreign/missing/deleted source: `404`. Encryption unavailable: `503`.

### `POST /api/office/invoice-extractions/:runId/review`

```ts
interface ReviewInvoiceRequest {
  expectedVersion: number;
  idempotencyKey: string;
  reviewedDraft: InvoiceDraft;
  confirmNoLineItems?: boolean;
  approveLearning?: boolean; // Explicit human opt-in; default false
}
```

Success: `200 ExtractionRunResponse`. Validation: `400`. Stale version: `409`. Foreign/missing: `404`.

### Invoice draft

```ts
interface EvidenceField<T> { value: T; confidence: number; evidence: string; }
interface InvoiceLine {
  id: string;
  partNumber: EvidenceField<string>;
  description: EvidenceField<string>;
  quantity: EvidenceField<number | null>;
  unitOfMeasure: EvidenceField<string>;
  unitPrice: EvidenceField<number | null>;
  lineTotal: EvidenceField<number | null>;
}
interface InvoiceDraft {
  documentType: EvidenceField<"invoice" | "credit_memo" | "unknown">;
  vendorName: EvidenceField<string>;
  vendorAccount: EvidenceField<string>;
  invoiceNumber: EvidenceField<string>;
  invoiceDate: EvidenceField<string>;
  purchaseOrderNumber: EvidenceField<string>;
  currency: EvidenceField<string>;
  subtotal: EvidenceField<number | null>;
  tax: EvidenceField<number | null>;
  shipping: EvidenceField<number | null>;
  total: EvidenceField<number | null>;
  lines: InvoiceLine[];
  warnings: string[];
}
```

## Data Models

### `invoice_extraction_runs`

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK, immutable |
| company_id | uuid | tenant FK, required |
| location_id | uuid | composite tenant/location FK, required |
| created_by | uuid | application user FK, required |
| reviewed_by | uuid | nullable application user FK |
| document_hash | char(64) | SHA-256, required, indexed with tenant |
| file_name | varchar(180) | required, sanitized display name |
| mime_type | varchar(64) | allowlist |
| byte_size | integer | 1..10 MiB |
| idempotency_key | varchar(120) | unique per company/creator |
| status | varchar(32) | constrained state |
| provider | varchar(32) | required |
| model | varchar(100) | required |
| prompt_version | varchar(40) | required |
| memory_snapshot | jsonb | IDs/versions only, not raw document |
| extracted_draft | jsonb | nullable on failure |
| reviewed_draft | jsonb | nullable before review |
| error_code | varchar(80) | bounded safe code |
| retryable | boolean | required |
| duration_ms | integer | non-negative |
| version | integer | starts 1; optimistic lock |
| created_at/reviewed_at | timestamptz | audit timestamps |

Additional observable provider fields: response ID and nullable input, output, and reasoning token counts.

### `invoice_source_documents`

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| company_id/run_id | uuid | unique tenant-scoped run lineage |
| ciphertext/iv/auth_tag | bytea | AES-256-GCM envelope; required while not deleted |
| key_version | varchar(40) | required |
| content_sha256 | char(64) | must equal run document hash |
| mime_type/byte_size | varchar/integer | allowlisted and bounded |
| training_status | varchar(24) | pending_review/eligible/excluded/deleted |
| retention_until | timestamptz | required |
| created_at/deleted_at | timestamptz | audit timestamps |

### `invoice_training_examples`

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| company_id/run_id/source_document_id | uuid | tenant-scoped lineage; one label version per run |
| predicted_draft/gold_draft | jsonb | immutable provider prediction and reviewed truth |
| quality_metrics | jsonb | correction count, warnings, reconciliation state |
| vendor_key | varchar(180) | reviewed tenant-local vendor key |
| extractor_provider/model/prompt_version | varchar | immutable provenance |
| reviewer_id | uuid | required |
| status | varchar(20) | eligible/quarantined/retired |
| label_version | integer | starts at 1; unique with run |
| created_at | timestamptz | audit timestamp |

### `invoice_source_access_events`

Append-only tenant/run/source/actor/action audit records. The table contains no document payload or extracted invoice values.

### `invoice_correction_events` (episodic memory)

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| company_id/run_id | uuid | composite tenant/run FK |
| reviewer_id | uuid | required |
| field_path | varchar(300) | stable path |
| predicted_value/reviewed_value | jsonb | bounded scalar/object fragment |
| correction_type | varchar(40) | changed/added/removed/confirmed |
| created_at | timestamptz | immutable |

### `invoice_semantic_facts` (semantic memory)

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| company_id | uuid | tenant FK |
| vendor_key | varchar(180) | normalized reviewed vendor |
| fact_type/fact_key | varchar | constrained/bounded |
| fact_value | jsonb | bounded learned value |
| status | varchar(20) | candidate/approved/rejected |
| evidence_count/contradiction_count | integer | non-negative |
| first/last_evidence_run_id | uuid | tenant-scoped lineage |
| approved_by/approved_at | uuid/timestamptz | nullable governance |
| version | integer | optimistic version |

Unique index: company, vendor key, fact type, fact key, canonical fact-value hash.

### `invoice_extraction_playbooks` (procedural memory)

| Field | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| company_id | uuid | tenant FK |
| vendor_key | varchar(180) | empty means company-wide |
| name | varchar(120) | required |
| rule_text | varchar(2000) | bounded, treated as data not instructions from invoice |
| version | integer | immutable unique version per name/scope |
| status | varchar(20) | draft/active/retired |
| created_by/approved_by | uuid | audit identity |
| created_at/approved_at | timestamptz | audit timestamps |

## Rollout and Rollback

- Code and additive tables can be deployed dark because no existing route consumes them.
- Enabling the office UI requires provider configuration and a tenant pilot.
- Rollback disables the UI/route and leaves append-only learning data intact for audit; dropping the new tables is not part of automatic rollback.
- Production migration, provider configuration, and rollout require separate authority from this implementation request.

## Local-first OCR and learned layouts

The first local OCR benchmark used the six supplied phone photos and the same engines already present in Hauliopy. PaddleOCR recovered 31 of 36 selected critical invoice tokens (86.1%) and returned positioned text regions. Tesseract recovered 25 of 36 (69.4%) and was much faster, but missed more invoice numbers, part numbers, and totals. The runtime order for camera invoices should therefore be PaddleOCR first and Tesseract as a fast fallback or health check.

`invoice-template-learning.js` is the provider-neutral learning core. It accepts positioned OCR regions plus a human-approved draft and produces only reusable structure:

- hashed stable, non-numeric layout signature markers with relative positions;
- page-relative field anchors and value shapes;
- learned line-table column centers;
- a deterministic template fingerprint and bounded quality metrics.

The learned artifact excludes matched invoice numbers, part numbers, descriptions, totals, dates, and other example-specific values. Signature markers and nearby labels are stored as hashes rather than readable source text. Templates are data, not vendor conditionals in application code. A later invoice must first match the stored signature; missing or ambiguous anchors remain warnings and require review.

### Teaching loop

1. The loopback-only Workorder OCR service runs PaddleOCR and returns text plus page-relative regions without retaining its own source copy.
2. A trusted template may propose local fields. If no trusted template matches, the generic geometry extractor creates a conservative local review draft; OpenAI is only an optional fallback when the local result has insufficient evidence.
3. The office reviewer corrects the draft and explicitly enables learning.
4. The backend aligns approved values to OCR regions and creates or reinforces a company- and vendor-scoped candidate template.
5. Candidate templates stay in shadow mode until they have multiple consistent approved examples and no unresolved contradictions.
6. A promoted template extracts locally. Arithmetic reconciliation, duplicate-invoice checks, low confidence, drift, or ambiguity sends the draft to review or the configured fallback provider.
7. Every fallback followed by an approved correction becomes new evaluation data. Provider output by itself never becomes truth.

### Promotion gates

- At least three approved examples from the same company/vendor/layout, including two different invoice numbers and totals.
- No source values present in the serialized template artifact.
- At least 98% exact match for invoice number, part number, quantity, and signed amount on a labeled holdout set; 100% total reconciliation for auto-approval eligibility.
- Cross-layout false-match rate below 0.1%; any material drift quarantines the template version.
- Tenant isolation, optimistic versioning, audit lineage, bounded OCR concurrency, timeout, and encrypted-source retention remain mandatory.
- OpenAI removal is a measured release decision: disable it for a template family only after the local path clears these gates, not merely because examples exist.

### Local operational evidence — 2026-08-24

- The standalone `workorder-invoice-ocr:local` image preloads PaddleOCR 2.10.0 and binds only to `127.0.0.1:8091`; the application remains on `127.0.0.1:4173`.
- Migration 063 is applied locally. Candidate templates require three approved examples before activation and remain company/vendor scoped.
- A fresh browser upload of the supplied Velocity invoice produced a `local_generic` review draft with vendor `Los Angeles Freightliner`, invoice `XC240109567:01`, date `7/30/2026`, subtotal `379.95`, tax `29.45`, shipping `0`, and total `409.40`.
- PaddleOCR did not recover the printed quantity on that camera image. The draft correctly left quantity empty and required review instead of inventing stock.
- The minimal upload control accepts up to ten files in one selection and processes them sequentially, keeping OCR concurrency bounded. Shared `Button`, `FormField`, and `OptionalSection` components own the interactive UI controls.
- The verified draft does not receive parts or mutate inventory/Odoo. Learning remains opt-in at review time.

## Out of Scope

- OS-1: Automatic Odoo receipts or stock changes — blocked until reviewed drafts and reconciliation quality meet a separate release gate.
- OS-2: Vendor/accounting master mutation — financial ownership requires a separate spec.
- OS-3: Autonomous semantic-fact approval — one bad correction must not poison future extraction.
- OS-4: Fine-tuning OCR/model weights and autonomously promoting a trained model — this slice deploys local PaddleOCR plus governed deterministic layout learning, but weight training remains a later gated phase.
- OS-5: Permanent source retention — encrypted documents have bounded retention; extension or legal-hold behavior requires a separate policy decision.
- OS-6: Email inbox ingestion and durable background batch queues — interactive multi-select is implemented, while unattended ingestion and worker queues remain deferred.
- OS-7: QR, serialization, receiving, and workorder issue flows — separate vertical modules consuming reviewed invoice drafts later.
- OS-8: Fleet, TMS, KPI, or predictive analytics — explicitly excluded from shop/workorder scope.

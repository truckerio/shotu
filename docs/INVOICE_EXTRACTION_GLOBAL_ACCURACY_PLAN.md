# Global Invoice and Document Extraction Accuracy Plan

Status: living execution plan, stress-test revision 3
Owner: Invoice Extraction module
Evidence level: architecture and executable plan controls only; production accuracy is not yet proven
Target: a lower 95% confidence bound of at least 95% for every declared field on every supported document-family slice, subject to minimum coverage gates

## 1. Outcome and truth boundary

Build a secure extraction system that learns reusable document **structure** across companies without retaining or sharing confidential company content. The system may claim support only for a versioned document family that has passed the evaluation contract in this plan.

“Handles any document” is not an honest or testable product claim. Unknown, unsupported, corrupted, adversarial, or low-confidence documents must safely abstain and enter review. New families become supported only after their own labeled evaluation clears every gate. Accuracy claims always state the field, family, slice, sample count, confidence interval, and coverage.

Initial supported candidates:

- Supplier invoices and credit memos, including multi-page line-item tables.
- Digital PDFs, scanned PDFs, phone photographs, and common image formats.
- English and USD first; every additional language, locale, and currency is a separate release slice.

Expansion candidates—receipts, purchase orders, bills of lading, statements, work orders, and packing slips—remain `experimental` or `unsupported` until promoted through the same registry and gates.

## 2. Product safety invariant

Extraction creates a reviewable draft. It does not establish financial, inventory, or work-order truth. Global learning must never auto-post inventory, approve an invoice, pay a vendor, or mutate a work order. Those actions remain explicit downstream commands with their own authorization and validation.

The system uses four terminal outcomes:

1. `accepted_draft`: all required gates pass; still reviewable.
2. `needs_review`: a field, reconciliation rule, or confidence gate fails.
3. `unsupported`: no released family/locale/currency capability matches.
4. `rejected`: unsafe, corrupt, encrypted, oversized, or malicious input.

## 3. Field contract

The current invoice schema is the first measurement contract:

- Header: `documentType`, `vendorName`, `vendorAccount`, `invoiceNumber`, `invoiceDate`, `purchaseOrderNumber`, `currency`, `subtotal`, `tax`, `shipping`, `total`.
- Line items: row identity/order, `partNumber`, `description`, `quantity`, `unitPrice`, `lineTotal`.
- Structural outputs: page association, table continuation, source evidence coordinates, and warnings.

Each field has a registry entry containing canonical type, normalization rules, allowed null behavior, criticality, minimum coverage, release threshold, reconciliation rules, supported family/locale/currency slices, and calibration version. Missing is distinct from zero; a paid balance of zero is distinct from invoice total; negative credits remain negative.

Before the final holdout is opened, seal the supported-capability registry and slice taxonomy with a content hash. It must include document family, field applicability, locale, currency, source modality, quality bands, and minimum support. A slice cannot be removed, merged, renamed, or declared “unsupported” after its results are known; that requires a new evaluation version and a still-sealed holdout. Field applicability is labeled from the source document, not inferred from whether extraction found a value.

Critical launch fields are invoice number, invoice date, currency, subtotal, tax, shipping, total, and all line-item fields. Vendor/account/PO requirements may vary by configured workflow, but their reported accuracy may not be hidden inside a combined score.

## 4. Accuracy and coverage contract

### 4.1 Metrics

Report every metric per field and per document-family slice. Macro averages are supplemental and may never mask a weak field.

- Presence detection: precision, recall, and F1.
- String fields: exact match after a versioned, field-specific normalization; raw exact match is also retained.
- Dates, currency, quantities, and money: typed semantic exact match. Numeric tolerance is fixed before evaluation and cannot hide wrong signs, decimal shifts, or currency.
- Line items: KILE field micro-F1, line-item recognition/grouping micro-F1, row count exact match, and row-level all-fields exact match.
- Document success: all critical fields and every line row correct in one document.
- Calibration: expected calibration error, Brier score, and reliability plots per field/model version.
- Selective prediction: accuracy as a function of coverage, review rate, false-accept rate, and selective risk.

For a predeclared field and slice:

- `eligible` = labeled documents/rows where the field is applicable, including applicable-but-missing truth.
- `returned` = eligible cases where the system emitted a non-abstained typed value.
- `correct` = returned cases exactly matching typed ground truth.
- `accuracy_when_returned = correct / returned`.
- `coverage = returned / eligible`.
- `end_to_end_success = correct / eligible`.

All three denominators and counts are published. Presence precision/recall handles optional fields; applicable-but-missing is still an evaluated class. Line-row denominators come from ground-truth rows, with explicit penalties for extra, missing, split, or merged rows.

### 4.2 Release thresholds

A field/family/slice releases only when all conditions pass on the untouched group-disjoint holdout:

- Wilson lower bound of the 95% confidence interval is at least 95% for typed semantic exact match.
- Critical-field point estimate is at least 98%; noncritical point estimate is at least 97%.
- Required-field coverage is at least 95%; abstention cannot be used to manufacture accuracy.
- False-accept rate for confidently wrong critical values is below 0.1%.
- Totals and line arithmetic accepted automatically only when deterministic reconciliation is 100% satisfied.
- Document-level all-critical-fields exact match is reported and must be at least 95% for automatic acceptance.
- No priority security, privacy, cross-tenant leakage, or parser-isolation test fails.

Sample size is determined before a release by a Wilson power calculation, not a fixed convenient count. At minimum, collect 300 labeled occurrences per field/family/slice; larger samples are mandatory when needed to demonstrate the 95% lower bound. Rare fields remain review-only until evidence accumulates. Report numerator, denominator, Wilson interval, coverage denominator, and excluded/abstained counts.

Because many fields and slices are tested, the evaluator controls family-wise error using a predeclared Holm-Bonferroni correction (or a stricter simultaneous-confidence method) across release-gating hypotheses. Nominal 95% intervals alone are not sufficient for the release decision. Both nominal and adjusted bounds are reported.

### 4.3 Anti-gaming rules

- Freeze schemas, normalizers, thresholds, and exclusions before opening the final holdout.
- Freeze the supported-capability registry, slice taxonomy, and minimum coverage per field before opening the final holdout; report every predeclared slice, including failures.
- Publish failure examples and worst-slice results, not only aggregate scores.
- Count duplicate retries once by source document lineage.
- A returned wrong value is an error even if a warning accompanies it.
- A blank or abstained required value reduces coverage.
- Human-corrected output is measured separately from straight-through extraction.

## 5. Evaluation corpus and leakage prevention

Maintain a versioned, consented, labeled evaluation manifest. Raw documents remain tenant-confined and encrypted; evaluators see only records they are authorized to access.

The annotation system uses a written field guide, source-coordinate evidence, two independent labels for critical fields, and blinded adjudication for disagreements. Track inter-annotator agreement and adjudication rate by field. A benchmark is invalid if label-quality sampling falls below its gate, if adjudicators can see model predictions before deciding truth, or if the test set contains unresolved labels. Corrections from normal operations are candidates, not ground truth, until validated under this policy.

Splits must be group-disjoint by company, vendor identity, layout/template family, source system, capture device, and time window. Use train, development, shadow, and final untouched holdout partitions. Keep both zero-shot (unseen company and layout) and few-shot (layout seen, document unseen) leaderboards. Never promote examples from the final holdout into training until a new holdout version is sealed.

Before splitting, a tenant-local lineage and near-duplicate audit groups originals, rescans, exports, revisions, crops, screenshots, OCR-equivalent pages, and synthetic derivatives of a real source. Use source IDs plus perceptual-image, normalized-native-text, and OCR n-gram similarity under access control; only non-reversible group IDs enter the manifest. An entire duplicate/derivative group belongs to one partition. Synthetic generators may not seed from final-holdout content.

Evaluation slices include:

- Digital text PDF, scan, fax, screenshot, and phone photo.
- Single-page and multi-page; one table and multiple tables; tables split across pages.
- Dense and sparse layouts; duplicate labels; rotated sidebars; stamps and handwriting.
- English initially, then each locale/language/currency independently.
- Seen vendor/unseen layout, unseen vendor/seen layout, and unseen vendor/unseen layout.
- Scanner/camera resolution, blur, lighting, background, skew, and compression bands.

Public datasets provide external comparability, not proof for private transportation invoices:

- [DocILE](https://arxiv.org/abs/2302.05658) for business-document KILE and line-item recognition across real and synthetic documents.
- [SROIE](https://arxiv.org/abs/2103.10213) for scanned receipt OCR and key information extraction.
- [FUNSD](https://arxiv.org/abs/1905.13538) for noisy form understanding and entity relationships.
- [DocVQA](https://arxiv.org/abs/2007.00398) for broad document layouts and visual/text reasoning.

Synthetic documents and perturbations expand coverage and adversarial testing, but never serve as the sole evidence for a production accuracy claim.

“Beats industry standards” may be stated only for a named public benchmark, identical task/schema/split/metric, reproducible configuration, and statistically significant result against a cited published baseline. Private-corpus results are product readiness evidence, not an industry leaderboard. Never compare vendor marketing percentages measured on different fields or datasets.

## 6. Extraction architecture

Use a modular pipeline with recorded provenance at every stage:

1. **Secure intake** — authorize tenant, stream upload, detect MIME from magic bytes, enforce page/pixel/archive and actual decompressed-byte limits, reject encrypted or malformed content, malware-scan, and assign immutable lineage.
2. **Isolated rendering** — render PDFs/images in a sandboxed worker with CPU, memory, time, page, and recursion limits; never execute embedded scripts, links, attachments, macros, or forms.
3. **Document normalization** — orientation, deskew, perspective correction, denoise, contrast variants, page boundaries, and native-text preservation.
4. **OCR ensemble** — native PDF text plus local OCR candidates with tokens, confidence, bounding boxes, reading order, and disagreement evidence.
5. **Family classifier** — select a released family/version or return `unsupported`; treat embedded document text as untrusted data, never as instructions.
6. **Candidate retrieval** — tenant-active layout first, privacy-safe global layout second, generic spatial/semantic extraction third.
7. **Structured extraction** — schema-constrained local or remote model call with provider storage disabled, least document content, fixed system instructions, bounded output, and evidence coordinates.
8. **Deterministic reconciliation** — types, dates, currency, signs, quantity × unit price, line sum, subtotal + tax + shipping − discount, duplicate invoice policy, and page/table continuity.
9. **Calibrated decision** — field-specific calibration and selective thresholds choose value, abstention, or review. A global-only layout can never raise a field above 89 confidence until locally confirmed.
10. **Human review and learning** — preserve predicted/reviewed values, reason, evidence, model/template versions, reviewer identity, and correction event; learn only through approved policies.

No single OCR or model response can bypass deterministic checks. Provider agreement is evidence, not truth; correlated models do not count as independent votes.

Remote providers are an optional, tenant-policy-controlled processor. Before use, Security and Legal record the DPA/subprocessor, no-training and zero-retention commitments, data region, approved model/endpoints, incident notice, and deletion/export terms. Enforce per-tenant opt-in, regional egress allowlists, dedicated secret isolation, request redaction/minimization, auditable model/version, budget/rate limits, and an immediate provider kill switch. Provider outage, policy mismatch, or kill-switch activation falls back to local extraction plus review; it never silently changes data residency or sends a document elsewhere.

## 7. Privacy-safe global structural learning

### 7.1 What may be global

Only geometry and coarse structure may cross tenant boundaries:

- Normalized page dimensions, zones, relative coordinates, reading-order relationships, table column positions, header/footer repetition, anchor-to-value offsets, and coarse value shapes such as `DATE`, `MONEY`, `INTEGER`, or `CODE`.
- Geometry is canonicalized and quantized to approved bins; ordering is deterministic; numeric ranges, list lengths, nesting, vocabulary, and serialized size are bounded. High-entropy or unique structures are rejected rather than globalized.
- Versioned HMAC-SHA-256 digests of allowlisted generic labels such as `invoice number`, `date`, `subtotal`, `tax`, and `total`, using a dedicated rotatable `INVOICE_LAYOUT_HMAC_KEY`.
- Aggregated performance/support counts with contribution limits and no tenant-identifying dimension.

Plain SHA-256 of labels is prohibited because a small label dictionary is reversible by enumeration. Global marker matching computes HMACs at runtime; the key is kept outside the database, versioned, access-controlled, audited, and rotatable.

### 7.2 What must never be global

Never copy or expose company, location, user, reviewer, or extraction-run IDs; vendor names or keys; invoice/account/PO numbers; dates; names; addresses; email; phone; tax IDs; part numbers; descriptions; quantities; prices; totals; currency values; raw OCR text; source documents/images; prompts; predicted or reviewed drafts; semantic facts; vendor playbooks; corrections; free text; filenames; or support examples.

Tenant templates remain tenant-scoped. Global templates use random global IDs, have no backlink to a tenant/run/user, and contain only the allowlisted structural schema. A canonical serializer and entropy/cardinality scanner prevent coordinates, ordering, padding, or unknown fields from becoming a covert channel. Logs, traces, analytics, backups, and error payloads follow the same prohibition.

### 7.3 Consent, contribution, promotion, and revocation

- Company administrator explicitly opts into structural contribution; reviewer explicitly confirms each eligible reviewed document. Default is off.
- A tenant-local sanitizer builds a new allowlisted payload; it never subtracts fields from a confidential payload.
- Contributions are rate-limited and capped per company/layout to resist poisoning and dominance.
- Promotion requires at least 5 independently reviewed documents from at least 3 companies, no company supplying more than 40%, company-split validation, critical-field exact match at least 98%, total reconciliation at 100%, false match below 0.1%, no contradictory anchors, and automated privacy/schema scans.
- New global versions enter shadow state, then canary, then active. Drift or contradiction automatically quarantines the version.
- Consent withdrawal tombstones the contribution, then deterministically rebuilds affected aggregate/global artifacts from the remaining eligible contributions. Until rebuild and revalidation complete, affected versions are quarantined. If a learned model cannot support exact contribution deletion, it may not train on cross-tenant contributions. Audit metadata records policy/version/time without retaining confidential content.

Differential privacy or secure aggregation should be evaluated before exposing usage counts externally; neither substitutes for strict minimization and tenant isolation.

## 8. Security threat model and controls

Follow the risk lifecycle in the [NIST AI Risk Management Framework](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10) and privacy controls in the [NIST Privacy Framework](https://www.nist.gov/privacy-framework), mapped to repository-specific tests and owners.

Threats and required tests:

- **File confusion and parser exploits:** mismatched extension/MIME/magic bytes, polyglots, embedded JavaScript, forms, attachments, malformed xref, huge dimensions, recursive archives, decompression bombs, password-protected PDFs, and corrupted images.
- **Resource exhaustion:** page bombs, giant tables, excessive OCR tokens, slow rendering, retry storms, and provider amplification. Enforce streaming, quotas, timeouts, circuit breakers, idempotency, and per-tenant rate limits.
- **Prompt injection:** visible text, white-on-white/hidden text, metadata, QR codes, barcodes, comments, and Unicode confusables that tell a model to ignore instructions or reveal data. Document content is delimited as data; model output is schema-validated and cannot invoke tools.
- **Output injection:** SQL fragments, formula injection, HTML/JavaScript, path traversal strings, control characters, and spreadsheet payloads. Store typed values; escape at each output sink; never construct queries or paths from extracted text.
- **Cross-tenant leakage:** cache keys, template lookup, job queues, object storage, logs, tracing, analytics, support tools, provider requests, and backups all receive explicit tenant-isolation tests.
- **Learning poisoning:** one company flooding contributions, coordinated bad reviews, marker collisions, adversarial templates, and rollback abuse. Apply support diversity, reviewer authorization, contribution caps, signed/versioned artifacts, quarantine, and lineage.
- **Structural covert channels:** over-precise coordinates, arbitrary ordering, unknown keys, floating-point payloads, and padding can encode tenant data despite a field allowlist. Canonicalize, quantize, bound entropy/cardinality, reject unknowns, compare serialized output to the schema, and fuzz the sanitizer.
- **Secret and data exposure:** encrypt source and derived artifacts in transit and at rest; short retention; provider storage disabled; no confidential values in logs; access-controlled deletion; key rotation; audit access and export.

Security failures always override confidence. Rejected inputs reveal a safe operator reason without echoing confidential content or parser internals.

## 9. Adversarial document matrix

The generator and curated corpus must include at least these cases, with expected value/review/reject outcomes:

- 0°, 90°, 180°, and 270° rotation; skew; perspective; cropped edges; mirrored pages.
- Blur, low resolution, JPEG artifacts, fax noise, shadows, glare, colored paper, faint thermal print, handwriting, stamps, signatures, and overlapping marks.
- Multi-column headers, vertical labels, duplicate labels, label/value on different pages, repeated page headers, blank pages, and mixed page sizes.
- Borderless, ruled, nested, sparse, dense, wrapped, merged-cell, and page-split tables; multi-line descriptions; subtotal rows inside tables.
- Decimal commas, thousands separators, parentheses negatives, credits/returns, zero tax, inclusive tax, discounts, freight, deposits, paid-zero balance, and multiple currencies.
- Part codes adjacent vertically, quantities such as `1/2`, OCR-confusable `O/0`, `I/1/l`, Unicode minus, non-breaking spaces, RTL text, and locale-specific dates.
- Duplicate invoices, revised invoices, credit memo referencing invoice, statement containing many invoices, and multiple documents in one upload.
- Hidden prompt injection, QR/barcode instructions, fake totals in fine print, adversarial filenames, SQL/XSS/formula/path strings, and Unicode confusables.
- Corrupt, truncated, encrypted, oversized, polyglot, archive, decompression-bomb, page-bomb, and high-pixel images.

Metamorphic tests assert invariants: rotation must not change semantic values; harmless compression may lower confidence but not silently change accepted values; page reordering must trigger continuity review; adding a paid stamp must not replace invoice total with balance due; and injecting instructions must not change extraction policy.

## 10. Test layers

1. **Unit:** normalization, typed parsing, HMAC marker creation/rotation, confidence calibration, amount/date/sign handling, row grouping, and reconciliation.
2. **Contract:** sanitized global payload allowlist, tenant isolation, provider no-storage configuration, log redaction, and schema rejection.
3. **Golden fixtures:** labeled real/synthetic documents with exact field, row, and evidence comparisons.
4. **Property/metamorphic:** randomized transformations and invariant checks.
5. **Adversarial/security:** malicious files and content under isolated resource limits.
6. **Offline benchmark:** sealed group-disjoint holdout with per-field Wilson intervals and coverage.
7. **Shadow production:** compare to reviewer decisions without changing operations.
8. **Canary:** limited companies/families, automatic rollback, and review-only outputs.

Every model, OCR engine, prompt, normalizer, template, calibration, and corpus change creates a new immutable evaluation run. A candidate cannot release if any field regresses below its gate, any priority slice regresses materially, or review/false-accept cost increases beyond budget.

Artifact manifests pin mutually compatible versions of the field schema, normalizer, OCR engine, prompt, extractor, template schema, HMAC key version, calibrator, and capability registry. Unknown or incompatible versions fail closed to review; rollback restores a complete compatible manifest, never an isolated model file.

## 11. Observability and governance

Maintain dashboards by model/template version, family, field, locale, capture type, confidence band, and anonymous cohort. Never display tenant-confidential values. Track coverage, typed exact accuracy from reviewed samples, calibration, reconciliation failures, review rate, correction rate, latency, provider cost, parser rejects, privacy scan failures, and drift.

Alerts quarantine the smallest affected family/template/model version. Preserve an instant rollback to the last passing version. Evaluation labels require double review for disagreements and periodic blind audits. Dataset/model cards record source authority, consent, retention, known limits, sample distributions, exclusions, and changes.

Data owners approve corpus authority and retention; Security owns intake isolation, privacy schema, sanitizer fuzzing, and incident gates; the Invoice Extraction module owns schemas, pipeline, reconciliation, confidence, and template lifecycle; QA owns sealed manifests, annotation audits, benchmark execution, and release evidence; Operations owns reviewer workflow and canary stop decisions. No owner may approve its own failed gate away.

## 12. Delivery phases

### Phase 0 — Measurement before model changes

- Freeze field schemas and normalization rules.
- Build the consented corpus manifest, annotation guide, adjudication workflow, and per-field baseline.
- Implement the sealed capability registry/slice taxonomy and blinded label-quality audit.
- Implement the Wilson/coverage/selective-risk evaluator and immutable run report.
- Measure the current generic OCR, tenant template, and remote-provider paths separately.

Exit: reproducible baseline; no unsupported accuracy claim.

Concrete artifacts:

- `invoice_extraction_capability_registry`: sealed family/field/slice/applicability/coverage contract and hash.
- `invoice_extraction_corpus_manifest`: authorized source lineage, consent/retention class, duplicate-group ID, partition, label status, and no document content.
- `invoice_extraction_annotations`: tenant-scoped typed truth, evidence regions, independent labelers, adjudication, and guide version.
- `invoice_extraction_evaluation_runs`: immutable artifact manifest, per-field counts, nominal/adjusted intervals, coverage, false accepts, slice results, and release verdict.
- A deterministic offline evaluator library plus CLI/report, golden fixture manifest, perturbation generator, malicious-file corpus, and CI smoke subset. Exact paths and migrations are fixed during implementation against then-current repository truth; no second extraction owner is created.

### Phase 1 — Secure deterministic foundation

- Harden intake/rendering isolation and resource limits.
- Improve native PDF + OCR geometry, typed parsing, totals, signs, dates, and line grouping.
- Add provenance and confidence calibration without global learning.

Exit: security suites pass; baseline improves on sealed development data.

Concrete artifacts: intake policy module, isolated renderer contract, OCR observation schema, typed normalizers, reconciliation engine, calibrated decision API, provenance record, resource-budget tests, and local/provider failure-state integration tests.

### Phase 2 — Privacy-safe global templates

- Add a new migration after current migration 084 for global structural templates, HMAC marker versions, contribution ledger, promotion state, and revocation lineage.
- Implement allowlist construction, tenant-local privacy scan, consent, HMAC key rotation, shadow matching, contribution caps, and quarantine.
- Canonicalize and quantize structural payloads; enforce entropy/cardinality/size bounds; fuzz unknown fields and covert-channel attempts.
- Implement contribution tombstones and deterministic aggregate rebuild/revalidation for revocation.
- Lookup order: tenant active → global active → generic extraction → optional remote reconciliation.

Exit: red-team privacy tests pass; company-disjoint shadow evaluation clears false-match and accuracy gates.

Concrete artifacts: global template schema/migration, canonical sanitizer, HMAC key-version adapter, consent/contribution/revocation service, deterministic rebuild job, promotion evaluator, shadow matcher, quarantine/rollback controls, and cross-tenant negative tests.

### Phase 3 — Ensemble and selective acceptance

- Compare OCR/model candidates; reconcile deterministically; calibrate each field and slice.
- Route disagreement and unsupported cases to focused review with evidence.
- Run shadow, canary, rollback, and drift exercises.

Exit: every declared field meets its lower-bound and coverage gate on untouched holdout and shadow review.

Concrete artifacts: candidate provenance graph, field calibrators, selective router, reviewer evidence UI/API, drift dashboard, canary manifest, automatic stop rule, and full-compatible-manifest rollback drill.

### Phase 4 — Family expansion

- Add one document family/locale/currency at a time through registry, annotation, threats, holdout, and canary.
- Never inherit an invoice accuracy claim for a receipt, PO, BOL, statement, work order, or packing slip.

Exit: the new family independently passes all applicable gates.

## 13. Release checklist and stop conditions

Release only when:

- Field registry, labeled manifest, immutable evaluation report, and artifact versions are linked.
- Capability registry and slice taxonomy were sealed before holdout access; label-quality and blinded-adjudication gates pass.
- Duplicate/derivative groups are partition-contained; multiple-comparison-adjusted release bounds pass.
- Every declared field/slice has Wilson lower bound ≥95%, required coverage ≥95%, and stated sample size.
- Critical point accuracy ≥98%, false accept <0.1%, accepted totals reconcile 100%, and document exact ≥95%.
- Security, privacy, tenant-isolation, poisoning, revocation, parser-resource, and prompt-injection suites pass.
- Remote-provider tenant policy, DPA/no-training/zero-retention/region controls, secret isolation, outage fallback, and kill-switch drill pass when remote processing is enabled.
- Global payload canonicalization, quantization, entropy/cardinality bounds, unknown-field rejection, and deterministic revocation rebuild pass.
- Shadow and canary results agree with offline evidence; rollback and quarantine drills succeed.
- Known unsupported cases are visible to operators and reliably abstain.

Stop or rollback on cross-tenant exposure, confidential logging, unexplained drift, calibration failure, false-accept breach, parser isolation escape, contribution poisoning, or any field falling below its confidence/coverage gate.

## 14. What “sure” means

No finite test proves extraction will handle every possible document. We are sufficiently sure to release a **declared capability** only when the evidence and operational gates above pass and the system safely abstains outside that capability. The durable advantage is not pretending uncertainty is gone; it is measuring each field, detecting unfamiliar inputs, protecting tenant data, and converting every authorized correction into a governed improvement.

## 15. Stress-test log

### Revision 0 — 2026-08-29

- Established measurable per-field lower-bound, coverage, false-accept, reconciliation, and document-exact gates.
- Replaced universal-document promise with a versioned capability registry and safe abstention.
- Defined privacy-safe structural globalization and a strict prohibited-content boundary.
- Added leakage-resistant splits, hostile-file/content matrix, promotion diversity, revocation, shadow, canary, quarantine, and rollback.
- Automated pass: 6/6 plan-contract and negative-mutation tests passed.

### Revision 1 — 2026-08-29, hostile review round 1

- **Saboteur — HIGH:** post-hoc slice selection could manufacture ≥95%. Added a pre-holdout sealed capability registry, immutable slice taxonomy, field-applicability truth, and mandatory reporting of every declared failure.
- **New Hire — MEDIUM:** label truth, version compatibility, and ownership were not executable enough. Added blinded double-label/adjudication gates, complete artifact manifests, explicit module/data/security/QA/operations owners, and fail-closed compatibility.
- **Security Auditor — HIGH:** precise structural payloads could encode tenant data, and withdrawal did not guarantee removal from aggregates. Added canonicalization, quantization, entropy/cardinality/size bounds, sanitizer fuzzing, deterministic rebuild, and quarantine during revocation.
- Disposition: all promoted findings accepted and addressed in revision 1. Next: extend the negative-mutation checker and perform a second hostile review.

### Revision 2 — 2026-08-29, hostile review round 2

- Automated pass after revision 1 initially failed 1/11 because the checker retained the superseded revocation phrase; contract drift was corrected before rerun.
- **Saboteur — HIGH:** near duplicates/synthetic derivatives could leak across partitions, while many nominal intervals could create a false release. Added tenant-local near-duplicate lineage grouping, partition containment, holdout-seed prohibition, and Holm-Bonferroni-adjusted release bounds.
- **New Hire — MEDIUM:** `accuracy`, `coverage`, and applicability denominators plus implementation outputs were ambiguous. Added exact count formulas, row-error treatment, and concrete artifacts for phases 0–3.
- **Security Auditor — HIGH:** provider storage-off did not establish lawful/private processing or containment. Added per-tenant policy/opt-in, DPA, no-training, zero-retention, region/egress, secret isolation, audit, outage fallback, and kill switch.
- Disposition: all promoted findings accepted and addressed in revision 2. Next: rerun all mutations, perform final review, and freeze verification evidence.

### Revision 3 — 2026-08-29, test-integrity review

- Automated revision-2 pass: 14/14 plan-contract and negative-mutation tests passed.
- **Saboteur — MEDIUM:** a required-keyword checker could pass contradictory unsafe prose. Added explicit forbidden-policy detection and contradiction-injection tests.
- **New Hire — LOW:** plan testing could be mistaken for model accuracy evidence. Kept the evidence banner and truth boundary explicit; the test validates planning controls only, while phase-0 corpus evaluation must establish actual accuracy.
- **Security Auditor — MEDIUM:** dangerous exceptions such as raw OCR globalization, default-on remote processing, or filename-trusting could be appended without removing the secure rule. Added forbidden patterns for those policies.
- Disposition: all findings accepted. Final verification must pass the positive contract, every destructive mutation, contradiction injection, syntax, repository structure, and diff hygiene.

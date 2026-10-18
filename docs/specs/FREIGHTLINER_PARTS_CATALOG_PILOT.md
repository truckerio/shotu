# Freightliner parts catalog pilot

Status: mechanic-first in-app catalog is the required product; external mechanic lookup is superseded. Minimal local Parts UI underway; diagram source/integration remains unconfirmed. Updated October 17, 2026.

## Outcome and scope

A mechanic identifies a part for the truck on a workorder, selects the exact item, and sends Office enough evidence to source it. Office verifies applicability and uses existing inventory, transfer, purchasing, receiving and installation workflows. Freightliner is the first brand; Cascadia is the initial diagram coverage target. Other makes retain their current request experience.

The preferred design is the fuller two-column catalog concept: assembly diagram/list on the left; selected identity, requested quantity and compact request controls on the right. Preserve information hierarchy and progressive disclosure rather than reducing everything to a small dialog. At phone widths, stack diagram, selection and request fields.

This document distinguishes the design target from capabilities available without a catalog agreement. A public official catalog website is usable as a lookup destination. It is not evidence of API access, embedded-viewer support, rights to copy diagrams, or fleet coverage. No demonstration part number or invented diagram may be shipped as Freightliner fitment data.

## Evidence and current owners

[DTNA's official Excelerator page](https://www.dtnaparts.com/excelerator/) documents PartsProX VIN/serial lookup, diagrams and interactive bills of materials. Access is dealer-sponsored. Its supported login destination is linked from that page. Confirm licensing, supported integration and actual VIN coverage with the dealer/provider before importing content.

Repository owners:

- `frontend/src/components/workorders/MechanicPartRequestForm.jsx`: shared mechanic-style request form and existing API submission.
- `frontend/src/components/workorders/part-requests/MechanicPartsSurface.jsx` and `OfficePartsSurface.jsx`: permission-gated embedding in the existing Parts surface.
- `frontend/src/components/workorders/part-requests/OfficeRequestCard.jsx`: Office review, fitment and supply decisions.
- `frontend/src/components/workorders/mechanic-part-request-model.js`: request draft validation and payload.
- `src/server/modules/parts/part.schemas.js` and `src/server/db/repositories/part-requests.repo.js`: request validation, durable identity and events.
- `src/server/db/repositories/parts-catalog.repo.js`: company master lookup; this is not yet a VIN-specific manufacturer catalog.
- `src/server/modules/inventory/inventory-purchasing.service.js`: purchasing/receipt command owner. Preserve existing demand-to-PO lineage.
- `src/server/integrations/vin/vpic.client.js`: basic VIN enrichment. It does not supply a parts BOM or component serial history.

Read `docs/ARCHITECTURE.md`, `docs/FRONTEND_OWNERSHIP.md`, and the current capability matrix in `docs/INVENTORY_ODOO_LIVING_RECORD.md` before extending these boundaries. Historical plans in the living record are not current implementation evidence.

## Polished UI target

### Mechanic

1. Open workorder → Parts → Request part. Truck is inherited from workorder; do not add another truck picker.
2. Show one compact truck strip: unit, year/make/model and VIN. Full configuration is disclosed when needed.
3. Browse truck system/assembly or use company number/description search. Clearly label the difference between company inventory and manufacturer catalog.
4. Display numbered diagram and a linked parts list. Tapping either selects the same item. Use one selected state and readable position/variant information.
5. Selection pane shows exact number, manufacturer, description, source and applicability status. Quantity/UOM and Send request remain visible. Notes/photos are optional supporting evidence.
6. After submission, show request state in existing workorder and Office queue. Never imply that submission means approval, reservation, order or physical receipt.

### Office

Show the mechanic's original selection and source beside the existing decision controls. Retain original evidence if Office proposes a different part. Fitment verification is separate from supply selection. Stock, transfer and purchase remain existing commands, with partial quantities and unresolved demand visible.

Keep price and supplier availability timestamped; a catalog image is not stock. Preserve existing exact-unit/quantity inventory policies and workorder completion guards.

## Delivery slices

### Slice A — Historical lookup increment (superseded mechanic experience)

Add a compact Freightliner reference panel to the existing shared request form. It receives current workorder asset context from its existing role surface. Detect the explicit Freightliner make without assuming every truck is a Cascadia. Show available unit/model/VIN and a supported official catalog link. Provide Copy VIN with truthful missing-VIN and clipboard-failure handling. Do not invent a prefilled VIN URL or send the VIN in a URL.

Keep company inventory search and normal description/quantity/UOM submission intact. Add an optional exact manufacturer-number entry for this pilot so a number identified in the external catalog can be requested even when absent from company inventory. Editing that number must clear any conflicting company selection; server remains owner of validation and fitment. Unknown descriptions continue through Office identification.

Use existing request `partNumber` field and authorized endpoint; no new database tables, provider credentials, manufacturer data imports, fitment confirmation or purchasing writes. State explicitly that PartsProX opens externally and dealer access is required. Do not display prototype diagrams in live request UI.

Acceptance:

1. Freightliner workorders expose the reference panel; unrelated/missing make does not accidentally select Freightliner.
2. Valid VIN copies exactly; missing/invalid VIN cannot report a copy success. Clipboard rejection provides a readable fallback.
3. External destination is a fixed official HTTPS URL, opens separately, and never appends truck/user data.
4. Exact number entered by mechanic survives request payload without AI substitution. Changing number invalidates a previous company catalog identity.
5. Existing company catalog selection still fills number, description and UOM. Existing permission gate, field errors, failed-submit draft retention and Office review remain intact.
6. New text follows existing locale owner; new CSS has feature ownership and fits phone/tablet/desktop without horizontal overflow.
7. New state does not persist across a different workorder/truck incorrectly.

### Slice B — Prove source and fleet coverage

Select 10–15 representative Freightliner trucks covering model years, engines and a modified truck. Obtain dealer-sponsored access and verify cooling, brakes/air, suspension, electrical and engine assemblies. Record success/missing coverage for every truck/assembly.

Ask provider for API/feed/embedded viewer or permitted internal document use; stable part/diagram/callout IDs; VIN and component constraints; supersessions; image and snapshot retention; authenticated multi-company access rights; refresh cadence; rate limits; sandbox; pricing. Do not share dealer passwords through chat. Public pages do not establish these answers.

Exit: one authorized data path, representative sample data, coverage matrix and cost/terms record. If only portal access is available, keep the minimal internal request form without sending mechanics to Excelerator; state that the in-app diagram catalog remains unavailable.

### Slice C — Durable selection evidence

Design a migration after source format is proven. Extend the current asset domain with sourced/effective-dated component configuration as required. Add separately owned catalog source/edition, assembly/diagram and callout records, plus a request-selection snapshot linked to existing part requests.

Snapshot includes selected truck/component, provider item, original number, diagram revision/callout, variant/position, source and verification state. Preserve OEM supersession separately from aftermarket interchange. Do not merge provider records into company master merely because normalized number strings match; manufacturer namespaces and reviewed mappings are required.

Enforce company entitlements and existing workorder/assignment access on catalog metadata, documents and request writes. Server resolves item identity from approved catalog records. Prevent client claims of verified manufacturer matches. Add audit provenance, stale-version behavior, retry idempotency and asset-change invalidation. Before migration execution, document representative legacy-data rehearsal, backup/rollback and rollout authority; code authorization alone does not authorize production migration.

### Slice D — Diagram viewer and request handoff

Implement approved Freightliner assemblies first. Use scalable artwork with accessible numbered buttons, keyboard list selection, zoom if needed, variant resolution and responsive two-column layout. Selection shows only applicable candidates or unresolved variant state. Distinguish assembly BOM quantity from requested quantity.

Office receives the same immutable source revision with existing request. Office can ask for a label/photo, verify current truck configuration, or propose an explicitly reviewed substitute. A prior installation can suggest a part but must not silently certify fitment.

### Slice E — Supply and pilot validation

Connect approved requests through canonical demand, existing stock/transfer/PO commands, partial receipts, issue, installation and return. Do not add a parallel purchasing queue or stock ledger. Revalidate quantities and availability at command time. Add explicit relationship for substitution and kit/assembly choices where existing fields do not suffice.

Pilot with two mechanics and one Office reviewer, 50–100 frequently requested items. Measure request time, unresolved-selection rate, Office follow-up, wrong-part returns and duplicate demand against baseline. Expansion to other brands follows evidence, not brand-name switches.

## Verification and release

Slice A: focused pure-model and rendered browser coverage for brand detection, VIN handling, copy failures, external link, exact number input, selection invalidation, request success/failure and changing truck/workorder. Run project `npm run verify`, existing CSS viewport harness and focused browser geometry at 390/768/1080/1920. Run full role workflow only against verified disposable local/staging configuration; otherwise report exact environment blocker.

Later API/schema slices require real route/authorization tests, cross-company and unassigned-user negatives, legacy-data rehearsal, concurrency/idempotency tests and fresh client-to-API browser evidence. Test expired entitlements, stale diagrams, unknown variant, source outage, engine swap, superseded part, conflicting manufacturer numbers, partial supply, incompatible UOM and repeated submission.

## Schedule and dependencies

- Slice A: first working increment; no catalog contract needed.
- Source proof: roughly 3–5 engineering days plus dealer/provider response time.
- Evidence model and viewer: roughly 2–4 engineering weeks after usable authorized data; re-estimate from actual format.
- Supply/pilot hardening: roughly 1–2 weeks depending on integration gaps.

User confirms existing dealer access. Dealer name, portal, usable VIN coverage, licensing prices and provider API availability remain unknown. Do not purchase, message providers, apply for accounts, commit, push or deploy as part of this request without further authority. Local implementation and reversible verification are authorized.

## Current delivery record

- Written plan: complete.
- Polished full-layout concept: restored and polished; illustrative data remains clearly labeled. Mechanic selection, request and Office fitment/supply interactions checked at 320–1024px preview widths without horizontal overflow.
- Slice A implementation: present in shared request form, both role consumers, feature-owned CSS, locale strings and focused model tests. Verification/review evidence is tracked separately by the execution task; no deployment performed.
- Slices B–E: planned; source access and rights are unresolved dependencies.

## Revised mechanic experience and source decision — October 17, 2026

User clarification: PartsPro is the mechanic catalog model; Excelerator is for Office purchasing. A link out to Excelerator is not delivery of the requested feature. Keep mechanics inside our app, with no dealer credentials or purchasing screens. The existing company-parts search is inventory lookup, not VIN-specific manufacturer fitment.

Minimal screen contract:
- Parts has one Request part disclosure and pending request rows first.
- Labor and actual parts stay reachable in a single Labor & parts used disclosure; preserve serialized lifecycle and permission enforcement.
- Remove the external Freightliner lookup card from the shared request form, duplicate request title/help, and provider-specific manual-entry instructions. Keep exact manufacturer-number entry and the working company inventory request flow.
- Once the source is proved, Request part adds Browse truck catalog. The workorder already identifies the truck: system/assembly -> diagram with numbered callouts and linked list -> selected part -> quantity -> Send request. Do not expose prices, suppliers or buying controls to mechanics.
- Office receives exact manufacturer/part number, description, requested quantity/UOM, unit/VIN, assembly, diagram revision and callout evidence. Office verifies the selection and chooses existing stock or purchase through canonical commands. No mechanic click sends a purchase order.

Integration research:
- [DTNA official catalog page](https://www.dtnaparts.com/excelerator/) confirms PartsProX VIN/serial-specific catalog, chassis/component diagrams and interactive BOMs. It documents portal functionality, not a public diagram API or raw catalog redistribution grant.
- [DTNA Fleet Boost brochure](https://dtnacontent-dtna.prd.freightliner.com/content/dam/enterprise/documents/DTNA-31999%20TMC%20Fleet%20Brochure_8.5x11_F2.pdf), page 5, documents Excelerator PunchOut for use from an internal punchout-capable system and Connect for order submission. These are real integration candidates. Exact protocol, sandbox, commercial eligibility, catalog-only role, returned diagram/callout metadata and ability to suppress provider purchasing UI still need provider confirmation. Do not infer a headless diagram API from PunchOut marketing.
- [DTNA registration overview](https://dtnacontent-dtna.prd.freightliner.com/content/public/DTNAConnect-NewUser.html) identifies PartsProX originally installed-parts BOM, cross references and supersessions; build records still need Office review when a truck has been modified.

Implementation path after entitlement/source proof:
1. Obtain supported integration specification/sample for one representative Cascadia VIN. Decide catalog-only supported viewer versus licensed diagram/BOM feed rendered by our own viewer. PunchOut may suit Office purchasing even if unsuitable for the mechanic UI.
2. Prove assembly/diagram/callout and item IDs, VIN/component scope, supersessions, source revisions, retention and entitlements. Reject a provider route that forces mechanic purchasing or cannot return exact selected identity.
3. Add server-side source adapter plus company/workorder-authorized reads. Keep provider secrets server-side; never scrape authenticated screens as the production integration or proxy arbitrary URLs.
4. Add approved catalog records and durable request-selection evidence. Request server resolves approved item identity/revision; preserve original choice if Office substitutes. Existing manual requests remain valid.
5. Build linked diagram/list picker only from actual approved data, test one truck/system, then expand Freightliner coverage. Selection and quantity become an Office request, never an order.
6. Verify cross-company isolation, invalid/expired access, wrong VIN/variant, changed component, stale diagram, failed source, duplicate submission, keyboard/phone access, exact evidence in Office and original stock/PO lineage.

Current dependency: user confirms Excelerator for buying and PartsPro for mechanics; no dealer name, supported integration specification, permitted diagram export or sample data has been supplied. Do not claim this dependency resolved. No native diagram viewer is live yet.

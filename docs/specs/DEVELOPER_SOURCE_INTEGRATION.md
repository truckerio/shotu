# Developer source integration — 2026-09-15

## Source and scope

Integrated the developer's `Downloads/src.zip` into the local staging-derived application at base `b174c7ad3cc52785e9afb607a864f6f9a31d6c1f`, on `codex/developer-integration`. The ZIP has no Git ancestry; this is reviewed source integration, not a merge of two known Git histories. No commit, push or hosted deployment is implied.

The developer version owns the purchasing workflow: purchase requests, purchase orders, approvals, delivery confirmation, Add to inventory, supplier bill documents, stock tasks and reports. Existing local storage-position accounting, commercial prices/tax and Workorder custody boundaries remain connected.

Source-only imports exclude duplicate `frontend - Copy`, temporary databases, build outputs, logs, environment secrets and dependency directories. Original dirty contents, patches, source archive hash and per-path import decisions are retained in the external `developer-integration/active` task directory. 1,348 normalized files matched; 79 files were new; 60 differing files had developer changes. Another 31 differences were local changes against unchanged developer copies and were retained.

## Integration decisions

- Preserve historical migrations through 135 and the existing migration checksum policy. Renumber developer migrations 133–148 to 136–151. Preserve `local_manual` receipt sources and `manual_receipt` stock movements alongside developer direct receipts.
- Keep the developer Purchases and compact Workorder Parts screens. Retain shared date controls, Safari-safe selection, local prices/tax and Storage locations.
- Shelves & bins opens a secondary view within the part/location detail panel and is closed initially.
- Direct receipts enter receiving positions; held deliveries remain outside usable stock. Transfers and damage/release must reconcile both shop and position stock.
- Route cycle counts to Storage locations. Block the imported independent count writer because it bypasses position accounting.
- Resolve permissions per target company. A user's admin membership in another company must not grant target-company admin rights.

## Verification record

- Pre-integration baseline `npm run verify`: passed (2,132 main tests: 2,086 passed, 46 skipped).
- Fresh merged source build: passed; final verification is recorded in the external task report.
- Populated upgrade: a disposable clone of `inventory_pricing_20260915` migrated through 151. All existing columns/rows across 41 inventory tables (265 rows) retained identical fingerprints. The original database remains unchanged. The initial comparison included a newly added nullable column; comparison of existing columns confirmed no historical changes.
- Fresh-database tests cover purchase approvals, receiving retries, serial identities, rollback, bill encryption and scope. Initial testing caught a serialized transfer retaining its old shop's shelf; integration repairs and final test results are recorded in the task report.
- Authenticated QA uses the disposable `inventory_developer_` database only. `scripts/qa/developer-integration.browser.js` exercises actual purchase/receipt/document APIs and rendered desktop, tablet and phone screens. It retains identifiable QA fixtures in that local database.

## Remaining product work

This merge does not implement the entire inventory roadmap. PO delivery confirmation still confirms all outstanding goods before separate stock intake. Batch purchase-cost propagation from PO/invoice, complete partial-delivery orchestration, automatic invoice-to-PO matching, batch warranty evidence, location-specific selling/internal price overrides and the future AI orchestration layer need their own implementation and acceptance tests. Existing part-level commercial prices must not be represented as location-specific prices. PO bill attachments preserve documents; attachment alone does not extract or post stock.

## Local navigation

Stock → part → location → Shelves & bins. Purchases → requests → Purchase orders → delivery → Add to inventory / bill documents. Tasks → returns/repairs, damage, transfers, cycle counts, exceptions. Reports → stock and purchasing reporting. Storage locations → hierarchy, stock positions and counts.

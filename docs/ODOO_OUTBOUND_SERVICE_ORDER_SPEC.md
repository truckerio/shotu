# Odoo Outbound Service Orders — Phase 2 Foundation

## Metadata

- **Author:** Codex with repository and live Odoo discovery evidence
- **Date:** 2026-08-03
- **Status:** Approved — the user explicitly requested implementation of the Phase 2 entry criteria
- Reviewers: Product owner; implementation self-review

## Context

The connected Odoo instance represents truck service records as `sale.order` rows with `is_service_order = true` and `vehicle_id` set to the Odoo `fleet.vehicle`. The truck's custom Services smart button reads exactly that relationship. The first normal line is the `[PTR001] LABOR HOURS` service product and its description contains the work performed; goods lines follow it.

Outbound creation is unsafe until provider identities are explicit. Live discovery found unique matches for 1,166 of 1,580 application assets, 69 ambiguous matches, and 345 unmatched assets. The existing stock-location mapping is unsuitable for order warehouses because one application location can map to many Odoo stock locations. PTR001 is also currently projected as `ea`, because the canonical unit registry does not contain Hours.

This phase establishes the durable, reviewable contracts required to create an idempotent Odoo draft. It reuses the existing encrypted credentials, company scope, integration audit, and mapping infrastructure. It does not automatically confirm or invoice an Odoo order.

## Functional Requirements

- FR-1: The system MUST discover active Odoo `fleet.vehicle` and `stock.warehouse` records by immutable Odoo ID without mutating Odoo.
- FR-2: An Admin MUST explicitly confirm one application asset to one Odoo vehicle. An Odoo vehicle MUST NOT be actively mapped to two application assets in the same company.
- FR-3: An Admin MUST explicitly map each application location used for outbound orders to exactly one active Odoo warehouse.
- FR-4: Discovery MAY present deterministic VIN, license-plate, and unit-number suggestions, but MUST NOT activate a suggestion without Admin confirmation.
- FR-5: The canonical unit registry MUST support decimal labor hours and map the Odoo UoM name `Hours` to the canonical `hr` code. A future Odoo sync MUST correct PTR001 from `ea` to `hr`.
- FR-6: Outbound preparation MUST require a positive labor-hours value with at most two decimal places and MUST use the workorder's current `work_performed` text as the labor description.
- FR-7: Customer resolution MUST default to the confirmed Odoo vehicle's customer and MAY store an explicit Odoo customer override for a workorder. The resolved customer MUST be visible in readiness output.
- FR-8: Draft creation MUST fail closed unless the workorder is office-approved, the Odoo connection is configured, the asset and warehouse mappings are confirmed, labor hours are valid, work performed is non-empty, the labor product is active with the Hours UoM, and every non-empty part line has an active Odoo product mapping.
- FR-9: Draft creation MUST create a `sale.order` with `is_service_order = true`, the mapped `vehicle_id`, resolved `partner_id`, mapped `warehouse_id`, and a stable workorder marker. PTR001 MUST be sequence 10 and goods MUST follow in their saved order.
- FR-10: The initial outbound implementation MUST create Odoo orders in Draft and MUST NOT call confirmation, invoicing, stock-picking, or payment methods.
- FR-11: Draft creation MUST be idempotent across concurrent calls, timeouts, and application restarts. It MUST recover an existing Odoo order by the stable marker before attempting a create.
- FR-12: Every preparation change, creation attempt, failure, recovery, and successful draft creation MUST be recorded through durable outbound state and the shared integration audit.
- FR-13: Successful creation MUST record the Odoo ID and service-order number and transition the workorder through the existing `odoo_entry_status` contract without requiring manual re-entry.
- FR-14: Admin APIs MUST remain company-scoped and protected by the existing `integration:admin` permission.

## Non-Functional Requirements

- **NFR-1 Reliability:** Repeating the same draft request 100 times MUST produce at most one recorded Odoo order ID for a workorder.
- **NFR-2 Security:** Odoo credentials MUST remain server-side and MUST NOT be returned by readiness, mapping, or draft APIs.
- **NFR-3 Performance:** Readiness MUST use indexed company/provider mappings and complete in no more than three application-database round trips, excluding Odoo preflight calls.
- **NFR-4 Scalability:** Vehicle and warehouse discovery MUST use bounded pagination and bulk persistence rather than one application transaction per remote record.
- **NFR-5 Observability:** Failures MUST expose stable application error codes while storing a bounded, sanitized provider message.
- **NFR-6 Accessibility:** New mapping controls MUST have programmatic labels, keyboard operation, visible status text, and a minimum 44px interactive height.

## Acceptance Criteria

### AC-1: Discovery remains reviewable (FR-1, FR-4, NFR-4)

Given Odoo returns vehicles and warehouses, when discovery runs, then immutable IDs and current labels are upserted and suggested matches remain pending review.

### AC-2: Mapping is tenant-safe (FR-2, FR-3, FR-14)

Given an Admin confirms mappings, when they are saved, then company ownership and one-to-one constraints are enforced; a non-Admin request is denied by policy.

### AC-3: Labor uses hours (FR-5)

Given an Odoo product uses UoM `Hours`, when it is imported, then its catalog UoM is `hr` and quantities such as `0.50` remain valid.

### AC-4: Readiness fails closed (FR-6, FR-7, FR-8)

Given any prerequisite is missing, when readiness is requested, then it returns a stable blocker code and draft creation performs no Odoo create call.

### AC-5: Draft payload matches Odoo (FR-9, FR-10)

Given all prerequisites are ready, when draft creation runs, then one draft `sale.order` payload contains the mapped vehicle, customer, warehouse, PTR001 first, and ordered part lines; no confirmation method is called.

### AC-6: Retry cannot duplicate (FR-11, NFR-1)

Given the same workorder is submitted concurrently or retried after a timeout, when creation is retried, then the database lock and stable Odoo marker return the original Odoo ID instead of creating another order.

### AC-7: Failures are auditable (FR-12, NFR-5)

Given Odoo rejects or times out, when the attempt ends, then retryable failure state and a sanitized audit event are stored without credentials or raw payload secrets.

### AC-8: Success updates existing workflow (FR-13)

Given Odoo returns a draft ID and name, when the result is recorded, then `odoo_entry_status` and the workorder lifecycle reference that same external identity.

### AC-9: Admin UI is safe and accessible (NFR-2, NFR-6)

Given an Admin uses the settings UI, when mapping data renders, then no secret is present and every control is labeled, keyboard operable, status-visible, and at least 44px high.

## Edge Cases

- EC-1: Duplicate VIN, plate, or unit values remain unresolved and cannot be auto-confirmed.
- EC-2: A previously mapped Odoo vehicle or warehouse becomes inactive; readiness becomes blocked without deleting audit history.
- EC-3: The Odoo vehicle has no customer and no explicit override; creation is blocked.
- EC-4: A part has a catalog identity but no active Odoo product identity; creation is blocked with the part number.
- EC-5: Labor hours are blank, zero, negative, too precise, or above the configured maximum; preparation is rejected.
- EC-6: Odoo creates the draft but the HTTP response is lost; retry searches the stable marker and records the recovered order.
- EC-7: More than one Odoo order already has the stable marker; creation stops with a conflict for manual reconciliation.
- EC-8: Mapping requests cross company boundaries; they are rejected.
- EC-9: Odoo lacks the custom `is_service_order` or `vehicle_id` field; readiness reports an incompatible-model blocker.
- EC-10: A workorder is returned from closed status before creation; creation is blocked by lifecycle eligibility.

## API Contracts

```ts
type MappingStatus = "unmatched" | "suggested" | "mapped" | "ignored";

interface OdooOutboundDiscoveryResult {
  vehicles: { discovered: number; suggested: number; mapped: number; unresolved: number };
  warehouses: { discovered: number; mapped: number; unresolvedLocations: number };
}

interface ConfirmVehicleMappingRequest {
  assetId: string;
  status: "mapped" | "unmatched" | "ignored";
}

interface ConfirmWarehouseMappingRequest {
  warehouseExternalId: string;
}

interface PrepareOdooWorkorderRequest {
  laborHours: number;
  customerExternalId?: string | null;
}

interface OdooReadiness {
  ready: boolean;
  blockers: Array<{ code: string; message: string; field?: string }>;
  vehicle: { externalId: string; displayName: string } | null;
  warehouse: { externalId: string; displayName: string } | null;
  customer: { externalId: string; displayName: string; source: "vehicle" | "override" } | null;
  labor: { productExternalId: string; uom: "hr"; hours: number | null };
}

interface OdooDraftResult {
  workorderId: string;
  status: "draft";
  externalId: string;
  serviceOrderNo: string;
  replayed: boolean;
}

// POST /api/integrations/odoo/discover-outbound
// GET  /api/integrations/odoo/outbound-mappings
// PUT  /api/integrations/odoo/vehicles/:externalId/mapping
// PUT  /api/integrations/odoo/locations/:locationId/warehouse
// PUT  /api/integrations/odoo/workorders/:workorderId/preparation
// GET  /api/integrations/odoo/workorders/:workorderId/readiness
// POST /api/integrations/odoo/workorders/:workorderId/draft
```

Errors use `{ error: { code: string; message: string; details?: object } }` and stable codes such as `ODOO_VEHICLE_UNMAPPED`, `ODOO_WAREHOUSE_UNMAPPED`, `ODOO_CUSTOMER_MISSING`, `ODOO_LABOR_INVALID`, `ODOO_PART_UNMAPPED`, `ODOO_MODEL_INCOMPATIBLE`, and `ODOO_DRAFT_CONFLICT`.

## Data Models

| Entity | Important fields | Constraints |
|---|---|---|
| `odoo_vehicles` | company, external ID, display/unit/VIN/plate, customer ID/name, active, app asset, mapping status, timestamps | Unique company + external ID; unique active company + app asset; mapped requires asset |
| `odoo_warehouses` | company, external ID, name/code, active, timestamps | Unique company + external ID |
| `odoo_location_warehouse_mappings` | company, app location, warehouse external ID, confirmed by/at | One warehouse per app location; one active app location per warehouse |
| `odoo_workorder_preparation` | company, workorder, labor hours, optional customer override, updated by/at | One row per workorder; labor hours positive and at most two decimals |
| `odoo_outbound_orders` | company, workorder, marker, state, attempt count, Odoo ID/name, last error, timestamps | One row per workorder; marker unique; external Odoo ID unique when present |
| `units_of_measure` | `hr`, Hours, h, time, scale 2, Odoo name Hours | Canonical active unit |

All provider tables MUST carry `company_id` and composite ownership foreign keys where the existing schema supports them.

## Out of Scope

- OS-1: Automatically confirming quotations/service orders in Odoo.
- OS-2: Creating invoices, payments, stock pickings, or purchase orders.
- OS-3: Automatically accepting ambiguous vehicle matches.
- OS-4: Replacing the existing inventory stock-location mapping.
- OS-5: Creating or modifying Odoo Studio fields automatically; the stable-marker recovery strategy uses existing Odoo fields plus application locking.
- OS-6: Historical bulk creation of service orders for already closed workorders.
- OS-7: AI-based customer, vehicle, warehouse, or labor-hour decisions.

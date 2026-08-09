# Workorder Detail Modules V2

## 1. Title and metadata

- Author: Codex
- Date: 2026-08-09
- Status: Implemented and verified locally
- Reviewers: Product owner

## 2. Context

Workorder detail now uses registered module owners across Admin, Office, Mechanic, and Surveillance surfaces. Role workspaces retain queue/navigation chrome, while module visibility, read/write rendering, controllers, and server actions resolve the canonical role, location, and named-user policy.

Odoo remains available from the Surveillance queue and Admin Operations Odoo backlog. Both open the shared workorder Odoo module. An authorized Admin sees Odoo throughout the workorder lifecycle; before approval the module explains why actions are unavailable and does not load readiness or expose mutations.

## 3. Functional requirements

- FR-1: The system MUST build workorder detail navigation from registered module identifiers and resolved role/location/user policy.
- FR-2: The system MUST expose the Odoo module on the shared Admin detail page when policy resolves Odoo access to read or write.
- FR-3: The system MUST hide the Odoo module when policy resolves Odoo access to hidden.
- FR-4: The system MUST render Odoo as read-only when policy resolves read access and MUST expose Odoo mutations only for write access.
- FR-5: User-specific module overrides MUST win over role/location defaults.
- FR-6: The Odoo detail UI and state controller MUST be reusable by Admin and Surveillance without duplicating provider requests or form behavior.
- FR-7: Surveillance queues MUST remain available as filtered work queues while their Odoo module uses the shared component contract.
- FR-8: A hidden or invalid `section` URL MUST fall back to the first visible detail module.
- FR-9: Existing mechanic and office detail workflows MUST retain their current visible sections and behavior unless policy explicitly changes them.
- FR-10: The module renderer MUST permit a future module to be added through registry metadata, section construction, and a renderer entry without creating a role-specific detail page.

## 4. Non-functional requirements

- NFR-1: Permission decisions MUST be enforced by existing server resource and role checks; UI visibility MUST NOT be treated as authorization.
- NFR-2: The shared Odoo module MUST preserve keyboard semantics, form labels, status announcements, and disabled-state behavior.
- NFR-3: Odoo readiness MUST load only when an eligible workorder exposes the Odoo module.
- NFR-4: Existing Surveillance Odoo endpoints and response contracts MUST remain backward compatible while shared module endpoints become canonical.
- NFR-5: Focused module, routing, and Odoo tests, the complete verification suite, and a production build MUST pass.

## 5. Acceptance criteria

- AC-1 (FR-1, FR-2): Given an Admin has Odoo access, when any workorder detail is built, then an `odoo` section is visible. Eligible workorders enable permitted actions; earlier lifecycle states show the unavailable explanation without provider requests.
- AC-2 (FR-3, FR-8): Given a policy hides Odoo and the URL requests `section=odoo`, when detail loads, then Odoo is absent and navigation falls back to the first visible section.
- AC-3 (FR-4): Given Odoo access is read, when the module renders, then readiness and existing Odoo result are visible but mutation controls are not available.
- AC-4 (FR-5): Given an Admin role default grants Odoo write but a user override hides it, when that user opens detail, then Odoo is not visible.
- AC-5 (FR-6, FR-7): Given Admin and Surveillance open the same eligible workorder, when Odoo is displayed, then both use the shared Odoo panel/controller contract and Surveillance queue navigation remains intact.
- AC-6 (FR-9): Given mechanic and office users use their default policies, when their detail sections are built, then their existing section order and actions remain unchanged.
- AC-7 (FR-10): Given a registered module has a visible resolved policy and renderer entry, when sections render, then it appears without a role-specific detail-page fork.
- AC-8 (NFR-5): Given implementation is complete, when focused tests, full verification, and build run, then all complete successfully.

## 6. Edge cases

- EC-1: Odoo readiness returns blockers or fails; the module shows the existing safe feedback and does not create a draft.
- EC-2: A workorder is not Odoo-eligible; the Odoo module remains visible to configured users but shows the safe lifecycle explanation and makes no readiness or mutation request.
- EC-3: No modules are visible; the existing empty-access state is shown.
- EC-4: A workorder already has an Odoo draft; the module shows the recovered service-order identity and disables draft creation.
- EC-5: Policy data is absent or malformed; defaults apply and no access is broadened beyond default role policy.

## 7. API contracts

The shared controller uses canonical module endpoints:

```ts
GET /api/workorders/:id/modules/odoo/readiness
PUT /api/workorders/:id/modules/odoo/preparation { laborHours: string }
POST /api/workorders/:id/modules/odoo/draft { expectedUpdatedAt: string }
POST /api/workorders/:id/modules/odoo/missing-info { note: string }
```

Each request MUST be protected by authenticated actor context, company/location workorder access, Odoo lifecycle eligibility, and resolved role/location/user module policy. Readiness accepts read or write access. Preparation, draft creation, and missing-information requests require write access. Existing `/api/surveillance/workorders/:id/*` Odoo routes remain compatibility aliases during migration.

## 8. Data models

No new database entity is required.

| Entity | Fields used | Constraints |
| --- | --- | --- |
| Workorder module policy | role, surface, module key, access | access is hidden, read, write, or required |
| User module override | user id, surface, module key, access | user override wins over role/location policy |
| Odoo readiness | workorder, customer, vehicle, warehouse, labor, blockers | existing server response contract |
| Odoo draft result | service order number, URL, replayed | existing server response contract |

Default Odoo detail access is Admin write, Surveillance write, Office hidden, and Mechanic hidden. Location policy and user overrides may grant read or write access, subject to the same server-side policy resolution.

## 9. Out of scope

- Removing the Surveillance queue.
- Changing Odoo provider payloads, synchronization, warehouse/vehicle mapping, or service-order semantics.
- Adding a general plugin marketplace or runtime-loaded JavaScript modules.
- Redesigning unrelated workorder sections.
- Committing or pushing the broader dirty V2 worktree without a separate user request.

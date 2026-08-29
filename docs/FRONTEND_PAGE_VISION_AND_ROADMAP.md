# Frontend Experience Vision and Page Delivery Roadmap

- **Status:** Design-management blueprint revised from Admin and four-role live rendered audits
- **Companion contract:** [Operator Page Design System](./OPERATOR_PAGE_DESIGN_SYSTEM.md)
- **Live rendered audit:** [Frontend Live UI Audit](./FRONTEND_LIVE_UI_AUDIT.md)
- **Collection and refresh contract:** [Frontend Collection, Data Density, and Refresh Contract](./FRONTEND_COLLECTION_REFRESH_CONTRACT.md)
- **Precision critic review:** [Frontend UI/UX Critique and Precision Polish Plan](./FRONTEND_UI_UX_CRITIQUE_AND_POLISH_PLAN.md)
- **Scope:** Every composed frontend page and page-like workflow currently reachable through authentication, role routing, Admin navigation, or inventory scanning
- **Planning boundary:** This document defines the intended experience and delivery sequence. It does not change APIs, permissions, Odoo authority, or domain workflows.

## 1. Product vision

Owl should feel like one operations system with different work modes, not a collection of role-specific mini-apps. An operator should understand three things within seconds of opening any page:

1. **Where am I?** The title, scope, and navigation clearly identify the current object or queue.
2. **What needs attention?** State and urgency are visible without inspecting every row.
3. **What can I do next?** One primary action or one obvious row-level next action leads the workflow.

Consistency applies to page geometry, hierarchy, controls, states, and navigation. It does not require identical information architecture. Mechanic, Office, Surveillance, Admin, Inventory, and Kiosk users have different jobs and should retain the density and tools those jobs require.

The current delivery order is based on live Admin, Office, Mechanic, Surveillance, and access audits, not source structure alone. Operations phone cards and filter disclosure, Locations navigation, Inventory contextual detail, workorder section navigation, and the access-panel visual family are reference patterns to preserve. Kiosk, valid invitation/reset, destructive, offline, permission-failure, and accepted/completion states remain audit-gated rather than presumed complete.

### Two leverage moves

Two composition changes now lead the page migration because they remove the most visible inconsistency without creating new domain implementations:

1. **One workorder workspace frame.** Create and Workorder detail already share `WorkorderDetailLayout`, `WorkorderObjectSummary`, and `WorkorderSectionNav`. Complete that partial convergence by extracting a neutrally named workorder workspace frame from the current detail surface and composing both flows through it. The frame owns breadcrumbs/back context, one heading strategy, object/draft summary, section navigation, supporting Preview/Chat pane, responsive collapse, and action placement. Create remains a draft-producing task; Detail remains a persisted-object workflow. They share geometry and navigation, not save semantics or permissions.
2. **One operational collection page frame.** Use Admin Operations as the interaction and proportion reference for Inventory: `OperatorPage`, `PageHeader`, responsive actions, `CollectionToolbar`, result state, 20-item paging, collection surface, and phone filter disclosure. Inventory retains stock columns, counts, invoice/count/scan entry points, inventory APIs, and `SecondaryDetailPanel`. Reuse the page composition; do not force inventory records into the workorder row component.

These are the first composed-page migrations after the foundation primitives. Other pages adopt one of the proven frames only when their operator task matches it.

## 2. Design-manager decisions

These decisions apply across the complete frontend:

- Use one neutral canvas, one page-header rhythm, one control scale, and restrained bordered surfaces.
- Preserve one canonical implementation for shared queues, workorder detail, Inventory, chat, Preview, drafts, and responsive filter sheets.
- Lead phone pages with decision buckets and the next action. Put secondary filters and destinations behind deliberate disclosure.
- Let desktop operational pages use width. Do not center a narrow card around a dense table.
- Use a dedicated object-page composition for workorder and location detail rather than styling them as list pages.
- Keep settings, template editing, and forms narrower than queues.
- Use blue for action, selection, focus, and links. Use semantic colors only for state.
- Avoid decorative glass, gradients, and inline shadows. Depth belongs to actual overlays.
- Never invent counts, timestamps, provider health, location facts, or permissions to make a page feel complete.
- Do not accept source-only completion. Every page requires rendered phone, tablet, and desktop evidence appropriate to its task.

## 3. Page families and canonical templates

| Family | Canonical composition | Pages |
| --- | --- | --- |
| Access | Centered task panel on a quiet canvas | Sign in, invitation, password reset, account unavailable |
| Shared-device access | Full-height touch workspace | Kiosk roster, kiosk unlock/PIN change |
| Role queue | Workspace header, page header, decision tabs, filters, collection | Mechanic, Office, Surveillance, Admin Operations |
| Admin collection | Admin shell, page header, toolbar, collection | Locations, Inventory, Modules, Settings index |
| Object detail | Breadcrumb, identity/status header, local sections, contextual actions | Workorder detail, Location detail, Surveillance detail |
| Creation | Task navigation, structured form, stable action footer, optional Preview | Create workorder |
| Focused utility | Single-purpose full-height task surface | Inventory scan |
| Embedded workflow | Host-aware heading and inherited geometry | Office Inventory, part requests, drafts, invoice intake, inventory files |

The implementation should add primitives only for these stable families. It should not create a new shell for every page.

## 4. Shared experience and performance contract

### 4.1 Perceived performance

- A route transition never produces a blank page. Show the destination shell or reserved skeleton immediately.
- Loading preserves the final layout’s geometry to avoid cumulative layout shift.
- Refreshing retains current data and marks it as updating instead of replacing the page with a spinner.
- Search and local filters respond in the same interaction frame. Server-backed queries cancel or ignore stale responses.
- Long phone queues continue to use the shared 20-row progressive renderer and expose the remaining count.
- Every list, table, queue, card collection, and bounded history shows `20` records by default. Additional records use pagination or increments of `20`; collections never mount an unbounded record set.
- Drawers and dialogs load secondary data after opening without blocking the underlying collection.
- Admin lazy loading remains, but its fallback must match the Admin shell rather than appear as an unrelated centered loader.

Collection quantity, column budgets, server/client pagination, progressive phone disclosure, polling eligibility, refresh state, and mutation reconciliation follow the [Frontend Collection, Data Density, and Refresh Contract](./FRONTEND_COLLECTION_REFRESH_CONTRACT.md). Page briefs may narrow that contract but may not silently exceed it.

### 4.2 Web experience budgets

These are validation targets, not claims about the current build:

| Metric | Target |
| --- | ---: |
| Largest Contentful Paint | `≤ 2.5s` at the 75th percentile |
| Interaction to Next Paint | `≤ 200ms` at the 75th percentile |
| Cumulative Layout Shift | `≤ 0.1` |
| Immediate action acknowledgement | Visible busy/pressed state within `100ms` |
| Phone route horizontal overflow | `0px` at `320px` and `390px` |

Measure the core role homes, Create, Workorder detail, Admin Inventory, and Inventory scan. Do not infer runtime performance from bundle completion.

### 4.3 Responsive validation

- Primary rendered widths: `390px`, `768px`, `1440px`, and `1920px` for dense operations.
- Reflow gate: `320px` CSS width and `200%` text zoom.
- Phone controls and touch layouts: at least `44px` targets.
- Pointer-dense desktop controls: at least `40px`, with at least the WCAG `24px` target minimum.
- Onscreen-keyboard flows must keep the focused field and primary action reachable.

## 5. Page inventory

The following inventory distinguishes composed pages from embedded modules so ownership remains clear.

### Access and shared-device pages

1. Standard sign in
2. Forgot-password dialog within sign in
3. Invitation acceptance and account-ready confirmation
4. Password reset
5. Account unavailable and route-loading recovery states
6. Kiosk mechanic roster
7. Kiosk unlock and required PIN change

### Role and administrative pages

8. Mechanic work queue
9. Office workorders hub
10. Admin Operations
11. Admin Inventory
12. Admin Locations
13. Location detail — Work
14. Location detail — Users
15. Location detail — Template
16. Location detail — Rules
17. Location detail — Kiosk
18. Admin Modules and module manager
19. Admin Settings — Integrations index
20. Admin integration detail — Samsara, Odoo, and machine clients
21. Surveillance queue

### Core workflow and utility pages

22. Create workorder
23. Shared workorder detail for Admin, Office, and Mechanic
24. Surveillance workorder detail
25. Inventory scan and exact-unit result

### Embedded workflows governed by their host page

- Office part-request queue
- Workorder drafts
- Office/Admin Inventory stock view
- Invoice intake and invoice detail
- Inventory files/count import and import detail
- Inventory part drawer, location serialization, and part-identity editor
- Workorder Chat, Activity, Parts, Preview, completion, and Odoo modules
- Profile, password, and passkey dialogs

## 6. Page-by-page design briefs

### 6.1 Standard sign in

**Operator job:** enter the product safely with a passkey or work credentials.

**Vision:** a calm, compact access surface with “Sign in” as the only page title. Passkey remains the preferred first action, password entry is clearly separated, and recovery stays adjacent to the password label. Avoid marketing content or a split-screen illustration that competes with the task.

**Layout:** centered access panel, maximum readable width around `440px`, generous phone-safe outer padding, visible labels, one primary submit action, and a quiet alternate passkey action. Errors appear beside the form without shifting the title off screen.

**Behavior:** preserve inventory-scan return routing, passkey fallback, keyboard-aware scrolling, submit busy state, and rate-limit-safe generic errors.

**Owner:** `frontend/src/features/auth/LoginPage.jsx`, `ForgotPasswordDialog.jsx`, and `auth.css`.

**Acceptance:** no clipped fields with the phone keyboard; focus moves to actionable errors; passkey and password methods remain independently operable; loading never resembles a signed-in workspace.

### 6.2 Invitation acceptance and password reset

**Operator job:** complete one secure account task with confidence.

**Vision:** reuse the access family rather than creating separate visual identities. Title, short explanation, required fields, requirements, status, and one primary action appear in that order. The success state replaces the form and clearly returns the user to sign in.

**Behavior:** invalid, expired, used, missing, busy, and success states have plain-language recovery. Password visibility, autocomplete, and field validation follow the sign-in pattern.

**Owners:** `frontend/src/features/admin/InviteAcceptPage.jsx`, `frontend/src/features/auth/ResetPasswordPage.jsx`, and `auth.css`.

**Acceptance:** both pages share the same panel geometry and form proportions as sign in at `390px` and `1440px`; error and success messages are announced once.

### 6.3 Account unavailable and route loading

**Operator job:** understand why work is unavailable and recover safely.

**Vision:** these are deliberate system states, not generic blank screens. Loading uses a stable shell with a meaningful label. Account failure uses a concise explanation and one safe Sign out action. Route-unavailable states preserve the authenticated shell when possible.

**Owners:** `frontend/src/features/auth/AuthGate.jsx`, `frontend/src/app/AppErrorBoundary.jsx`, and `frontend/src/app/routes/RoleWorkspaceOutlet.jsx`.

**Acceptance:** no infinite unlabeled spinner; focus and screen-reader state are clear; technical details are not exposed to operators.

### 6.4 Kiosk mechanic roster

**Operator job:** find and select a name quickly on a shared shop computer.

**Vision:** a full-height, large-target roster optimized for touch, gloves, distance, and repeated use. Location identity is prominent but subordinate to “Choose your name.” Language selection stays visible. Standard login is available without competing with mechanic selection.

**Layout:** responsive roster grid; strong initials/name recognition; minimum `56px` row height with `44px` absolute target minimum; empty roster provides the administrator next action.

**Behavior:** selection is immediate, refresh is explicit, and locale changes update the whole surface consistently.

**Owner:** `frontend/src/features/kiosk/KioskGate.jsx` and `kiosk.css`.

**Acceptance:** operable at `768px` landscape and `390px`; names never truncate beyond recognition; target spacing prevents accidental adjacent selection.

### 6.5 Kiosk unlock and PIN change

**Operator job:** unlock the selected mechanic session or replace a temporary PIN.

**Vision:** preserve the selected mechanic’s identity at the top, then present only the fields required for this session. The back action reads “All mechanics.” Required PIN change is a clearly labeled second step, not an unexpected cluster of fields.

**Behavior:** numeric input, error recovery, busy state, and standard-login escape remain obvious. Avoid auto-submitting before the operator can confirm identity.

**Acceptance:** keyboard does not cover submit or errors; PIN requirements are communicated before failure; returning to the roster clears private input.

### 6.6 Mechanic work queue

**Operator job:** decide what to work on now, accept available work, and reopen completed work when allowed.

**Vision:** phone-first and calm. “My work,” “Available,” and “Done” are the primary decision buckets. Each row leads with unit identity, work state, location, concern summary, and the one relevant next action. Search, language, and secondary controls do not crowd the primary tabs.

**Desktop:** use the shared queue proportions and available width, but do not add Office-style management density.
**Phone:** cards remain compact, decision oriented, and progressively rendered in batches of 20. Offline state is visible without taking over the page.

**Performance:** keep current rows during automatic refresh; accept/open actions acknowledge immediately and guard duplicate submission.

**Owner:** `frontend/src/features/mechanic/MechanicWorkspace.jsx`, `mechanic-workspace.css`, shared `WorkorderQueue`, and responsive queue owners.

**Acceptance:** the next job is identifiable without opening rows; no horizontal movement at `320px`; locale, offline, empty, filtered-empty, busy, and API error states render deliberately.

### 6.7 Office workorders hub

**Operator job:** triage work requiring office action, balance mechanic workload, manage parts/drafts, and complete Odoo handoff.

**Vision:** a desktop operations cockpit with a restrained mechanic workload rail and a dominant queue. “Needs action” is the default and visually strongest queue. Handoff reasons appear as concise row context, not detached alerts. Inventory, Parts, and Drafts are embedded destinations with their own local headers.

**Desktop:** two-column composition only for workorder queues; the workload rail disappears for Parts, Drafts, and Inventory. Filters form one aligned toolbar.
**Phone:** primary destinations are “Needs action,” “In progress,” and “Done / Odoo.” Secondary queues and filters live in the shared filter sheet.

**Performance:** retain current queue during refresh; avoid recalculating unrelated embedded views; preserve shared progressive rendering and server pagination boundaries.

**Owner:** `frontend/src/features/office/OfficeWorkspace.jsx`, `office.css`, `officeWorkspaceConfig.js`, and shared queue components.

**Acceptance:** urgent handoffs are distinguishable from normal rows; switching embedded views does not create double headings or nested page gutters; workload rail never compresses the main table below usable width.

### 6.8 Admin Operations

**Operator job:** oversee work across authorized locations and open operational detail.

**Vision:** the Admin version of the shared operations collection. The page starts at the same title position as Locations and Inventory. Location scope and queue controls are immediately below the header; Create workorder is the single header-level primary action when authorized.

**Layout:** `OperatorPage variant="page"`, `PageHeader`, shared Operations workspace, one collection surface. Avoid an extra white card solely around the page.

**Owner:** `frontend/src/features/admin/workspace/OperationsPage.jsx`, `frontend/src/components/operations/OperationsWorkspace.jsx`, and their CSS.

**Acceptance:** geometry matches Admin Locations at every breakpoint; filters, drafts, pagination, and queue behavior remain domain-owned; no API or status vocabulary changes.

### 6.9 Admin Inventory

**Operator job:** understand stock, find a part, inspect location/serial detail, and enter Invoice or Count workflows.

**Vision:** a stock-led collection page, not a separate visual application. “Parts inventory” uses the canonical Admin page title. Count is a secondary action; Invoice is the primary action. Search, location scope, availability filters, result state, and stock rows follow the shared collection rhythm.

**Embedded mode:** the Office host supplies its own page title; Inventory begins at `h2`, inherits padding, and avoids a nested page shell.
**Detail:** part details remain in the shared contextual side panel so operators do not lose collection state.

**Performance:** refresh keeps current stock visible; selecting a part defers location/serial detail loading; pagination remains server-aware; stale requests cannot replace newer filters.

**Owner:** `frontend/src/features/inventory/InventoryWorkspace.jsx`, `inventory-workspace.css`, Inventory models, and `SecondaryDetailPanel`.

**Acceptance:** Admin and Office use one feature implementation; title semantics differ correctly by presentation; filters and selected-part state survive safe detail navigation; authority labels clearly separate local and Odoo values.

### 6.10 Invoice intake

**Operator job:** upload an invoice, review extracted facts, and explicitly add approved physical inventory.

**Vision:** a focused sub-workflow inside Inventory. Breadcrumbs preserve “Inventory → Invoice intake → document.” History/list and upload are the entry state; source document and review controls form the detail state. Physical receipt confirmation is explicit and cannot be implied by extraction success.

**Layout:** use one bounded source-and-review workspace below a shared title. On wide desktop, begin validation near a `52/48` or `55/45` source/review split, enforce useful minimum widths, and let the review rail scroll within the available viewport height. The rail opens `Needs attention` first, then Invoice details, compact Line items, Totals and checks, and Approval. Completed sections collapse to value summaries with state, issue count, and Edit; they remain reopenable. On phone, remove the split and nested scroll: use explicit Document and Review modes, keep unresolved count/draft state persistent, and open directly on the first unresolved field when attention exists.

**Save model:** collapsing a section does not imply persistence. Dirty, saving, saved, and failed state remain visible. Exclusive one-section-at-a-time behavior is allowed only after the owner proves section completion is persisted or clearly staged and prior summaries remain available for cross-checking.

**Performance:** document preview loads progressively, upload progress is visible, and history is server paginated. Preserve the parent locations passed into Intake rather than making a duplicate template request.

**Owners:** `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`, `InvoiceDocumentViewer.jsx`, `InvoiceHistoryPanel.jsx`, `PhysicalReceiptConfirmation.jsx`, and colocated CSS/models.

**Acceptance:** extracted, reviewed, received, imported, and failed are visually and semantically distinct; no local inventory activation occurs without the authorized confirmation path. The first unresolved field is reachable within one action; source and value remain comparable at ordinary desktop zoom; line items do not begin below the source canvas; reopening a completed section loses no edits; sticky approval never obscures focus at `100%` or `200%` zoom.

### 6.11 Inventory files and count import

**Operator job:** upload, review, and apply a count import when authorized.

**Vision:** a reviewable file history with state, location, uploader, time, validation outcome, and one next action. Upload begins in a dialog; import detail stays within breadcrumb context. Apply is visually dangerous/committal only at the exact confirmation step.

**Performance:** file lists paginate; upload and validation progress are distinct; refreshing never discards the selected import result.

**Owner:** `frontend/src/features/inventory/InventoryCountImportPanel.jsx` and Inventory CSS/model owners.

**Acceptance:** Office can review but cannot see an enabled Apply action; Admin authority is explicit; failed rows and aggregate results remain understandable without downloading the source file.

### 6.12 Admin Locations

**Operator job:** find a shop, see readiness and open work, or add a location.

**Vision:** a clean operational index. The location name and address are the primary identity. Assigned active users, open work, and template readiness are supporting signals. “New location” is the single header action.

**Desktop:** stable five-column collection with aligned counts.
**Phone:** cards show identity, open work, and template readiness; secondary user count may sit in metadata. Entire-card navigation remains keyboard correct.

**Owner:** `frontend/src/features/admin/workspace/LocationsPage.jsx` and `admin.css`.

**Acceptance:** loading does not collapse the table; pagination stays attached to the collection; focus returns to the originating location row after leaving detail.

### 6.13 Location detail — shared shell

**Operator job:** manage one location without losing company context.

**Vision:** a true object page. Breadcrumbs lead back to Locations; title and address identify the shop; local tabs organize Work, Users, Template, Rules, and Kiosk. Tabs represent stable sections, not five unrelated page templates.

**Phone:** title stays compact; tabs use horizontal overflow or an accessible section selector without hiding the active section.
**Owner:** `LocationDetailPage` in `frontend/src/features/admin/workspace/LocationsPage.jsx`.

**Acceptance:** one `h1`; section titles begin at `h2`; URL/history and focus restoration remain predictable; every tab shares the same content start and maximum width policy.

### 6.14 Location Work

**Operator job:** see work limited to the selected location.

**Vision:** reuse Operations with fixed scope. Do not repeat a location picker or create a second queue implementation. The selected location is already established by the object header.

**Owner:** shared `OperationsWorkspace.jsx` composed by Location detail.

**Acceptance:** fixed scope cannot silently broaden; queue state, empty states, and detail navigation match Admin Operations.

### 6.15 Location Users

**Operator job:** understand who has access, invite users, and perform safe account actions.

**Vision:** one Users section with clear groups: company-wide admins, assigned active, inactive, then pending invitations. Row identity and account state precede actions. Desktop may expose a concise action cluster; phone uses the existing accessible menu.

**Behavior:** destructive actions require explicit confirmation. Self-protection and disabled reasons remain visible. Invite success clearly distinguishes emailed invitations from generated links.

**Owner:** `frontend/src/features/admin/workspace/UsersPage.jsx`, Admin dialogs, and `admin.css`.

**Acceptance:** account, membership, role, kiosk PIN, and invitation state cannot be confused; action menus are keyboard complete; long usernames/emails do not break row geometry.

### 6.16 Location Template

**Operator job:** edit the location’s printable workorder identity while seeing the result.

**Vision:** a focused editor with live Preview. Desktop uses a form/preview split with a stable sticky save area. Tablet may stack form above Preview. Phone edits one logical group at a time and opens Preview deliberately.

**Behavior:** dirty, saving, saved, and failed states are explicit. Preview is not mistaken for a second editable form.

**Owner:** `frontend/src/features/admin/workspace/TemplatePage.jsx` and Admin template CSS.

**Acceptance:** long legal/footer copy remains usable; Preview represents the saved/draft state truthfully; leaving with unsaved changes follows the shared draft/leave pattern where adopted.

### 6.17 Location Rules

**Operator job:** understand and change location-specific workflow policy.

**Vision:** a narrow settings surface. Each rule includes a plain-language title, consequence, current value, and inheritance/source when relevant. Module access remains linked to the canonical Modules page instead of being duplicated here.

**Owner:** `WorkorderRulesPage` in `TemplatePage.jsx` and Admin policy owners.

**Acceptance:** save scope names the location; changes are reviewable before mutation; success/error stays near the rule set; inherited versus overridden values are never communicated by color alone.

### 6.18 Location Kiosk

**Operator job:** register, inspect, or revoke shared shop computers.

**Vision:** device management rather than a generic settings card. Show device identity, status, location, last meaningful activity when available, and the one valid next action. Registration instructions use progressive disclosure.

**Owner:** `frontend/src/features/admin/KioskSettingsPanel.jsx`, `kiosk-settings.css`, and Admin kiosk contracts.

**Acceptance:** active, expired, revoked, and pending registration states are distinct; secrets or one-time registration values receive copy/dismiss behavior appropriate to sensitive data.

### 6.19 Admin Modules

**Operator job:** understand and change module access at company, location, role, or user scope.

**Vision:** scope first, then modules. The page header contains the scope selector. Empty state instructs the administrator to choose company default before creating exceptions. Module cards summarize effective access and source; the manager is a focused detail surface with a clear path back.

**Layout:** forms/settings maximum width, not the full `1920px` queue width. Keep dense permission matrices readable with sticky labels when needed.

**Owner:** `frontend/src/features/admin/modules/ModulesPage.jsx`, controller/model, and `modules.css`.

**Acceptance:** effective, inherited, default, and overridden access are textually explicit; changing scope cannot carry stale edits; keyboard and screen-reader users can understand row/column relationships.

### 6.20 Admin Settings — Integrations index

**Operator job:** understand which external systems are connected and where attention is needed.

**Vision:** a registry, not a dashboard of decorative cards. Each provider summary includes identity, purpose, connection/configuration state, and one meaningful operational fact. “Manage” opens a detail object while retaining a Settings breadcrumb.

**Owner:** `frontend/src/features/admin/integrations/IntegrationsSettings.jsx`, `IntegrationSummaryCard.jsx`, and integration CSS.

**Acceptance:** unknown and unavailable provider state is not shown as healthy; the index remains useful with partial provider failures; cards align and scan without equal-height filler copy.

### 6.21 Admin integration detail

**Operator job:** configure, test, synchronize, map, issue credentials, or disconnect one integration.

**Vision:** each provider uses the same detail header and state grammar, while its task body remains provider-specific. Connection, authorization, mapping, and last synchronization are separate concepts. High-impact actions are located where their consequences are explained.

**Samsara:** connect/test/sync/disconnect with truthful timestamps and confirmation.
**Odoo:** progressive location mapping with unmatched work made visible.
**Machine clients:** active credentials list plus one-time secret disclosure and revoke confirmation.

**Owners:** provider cards and models under `frontend/src/features/admin/integrations/`.

**Acceptance:** loading or failed tests never erase known configuration; destructive confirmation traps/restores focus; secrets are not redisplayed after dismissal; provider-specific errors stay beside the triggering action.

### 6.22 Surveillance queue

**Operator job:** review operational records, prioritize Odoo backlog/issues, and move efficiently through a filtered batch.

**Vision:** an audit queue rather than an editing workspace. Primary phone destinations remain Needs Odoo, Entered, and Issues; Active and Awaiting Office remain available through secondary disclosure. Search, location, and date range form one coherent filter system.

**Desktop:** dense shared queue with readable date controls.
**Phone:** date presets first; custom dates expand only when requested.

**Performance:** preserve current results during automatic refresh and reset progressive rendering only when queue/search/filter identity changes.

**Owner:** `frontend/src/features/surveillance/workspace/SurveillanceQueueView.jsx`, queue model/controller, `SurveillanceWorkspace.jsx`, and `surveillance.css`.

**Acceptance:** “no records” and “filters hide records” are distinct; dates and locations remain applied when navigating into and back from detail; filter sheet focus behavior is shared and verified.

### 6.23 Create workorder

**Operator job:** create a valid workorder with the minimum required information, then print or return to the correct role home.

**Vision:** the draft mode of the canonical workorder workspace, not a separately styled creation window. Location and unit establish context; concern and schedule capture the job; assignment and Parts appear only when policy permits; Preview supports confidence without dominating data entry. The same frame, summary proportions, section navigation, supporting pane, and responsive transition used by Workorder detail remain visible as the draft becomes a persisted workorder.

**Desktop:** structured form on the left and Preview/supporting pane on the right.
**Tablet:** stacked or adjustable composition with action continuity.
**Phone:** one section at a time, compact section navigation, keyboard-safe content, and a stable action dock. Validation opens the correct section before focusing the field.

**Performance:** vehicle lookup and location-scoped data are cancellable and do not block unrelated fields; Preview updates without remounting the whole page; drafts preserve meaningful work for authorized roles.

**Owner:** shared workorder workspace frame extracted from `frontend/src/components/workorders/WorkorderDetailSurface.jsx` and `WorkorderDetailLayout.jsx`; `frontend/src/features/create-workorder/CreateWorkorderPage.jsx`, `CreateWorkorderShell.jsx`, form/module owners, draft/vehicle/location controllers, and create-only CSS.

**Acceptance:** Create and Detail have identical outer geometry, summary alignment, section-navigation behavior, Preview sizing, and phone transition rules; Create has one visible title; draft/saving/error state remains explicit; no role-specific duplicate form; permissions hide unavailable modules before interaction; create, save draft, leave, validation, print, and recovery are rendered at all target widths.

### 6.24 Shared workorder detail

**Operator job:** understand one workorder, perform the next authorized action, collaborate, and inspect supporting evidence.

**Vision:** the product’s canonical object page. Breadcrumbs and object identity lead; status and role-valid actions follow; a compact summary answers unit, location, schedule, concern, mechanic, and customer questions; section navigation exposes only authorized modules. Preview and Chat occupy the shared supporting surface rather than becoming separate top-level pages.

**Desktop:** object content plus supporting pane with deliberate width and independently stable scrolling.
**Phone:** one compact section at a time, with Work/Parts/Chat/Activity/More ordered by operator need; Preview is a real section/fullscreen task, not a crushed side pane.

**Role behavior:** Mechanic prioritizes diagnosis/work, Parts, Chat, and Work done. Office/Admin prioritizes assignment, review, return/close/cancel, Odoo, and full edit capability according to policy.

**Performance:** realtime updates merge without losing unsaved local edits; Chat and Activity append without remounting the object page; Preview is lazy enough not to block initial actionable content.

**Owner:** the same shared workorder workspace frame used by Create; `frontend/src/features/workorder-detail/WorkorderDetailPage.jsx`, `WorkorderDetailSections.jsx`, module registry/hosts, and their narrow detail-only CSS owners.

**Acceptance:** Admin, Office, and Mechanic share one detail composition; title/status/summary do not duplicate section content; focus returns to the originating queue row; all policy combinations preserve a valid heading and section order.

### 6.25 Surveillance workorder detail

**Operator job:** inspect a record and move through a review batch without gaining edit affordances.

**Vision:** converge visually on the canonical workorder object page while retaining read-only review behavior and previous/next batch navigation. The batch position belongs in the header action area; Preview follows the same supporting-pane contract.

**Owner:** `frontend/src/features/surveillance/workspace/SurveillanceDetailPage.jsx` and shared detail/module owners.

**Acceptance:** no editable controls leak through policy; previous/next preserves filters and handles batch edges; shared object-page geometry matches the role-aware detail at all widths.

### 6.26 Inventory scan and exact-unit result

**Operator job:** scan or enter one label and immediately understand the exact physical unit.

**Vision:** a focused utility optimized for a phone in the shop. Camera is the primary action when available; manual code entry is the dependable fallback. The result leads with stock/custody state, location, part, serial, receipt lineage, and event history. “Scan another” is the clear continuation.

**Behavior:** camera permission, unsupported browser, invalid code, expired/void identity, loading, success, and retry states are explicit. Camera tracks stop whenever the task leaves scanning mode.

**Owner:** `frontend/src/features/inventory/InventoryScanWorkspace.jsx`, `InventoryCodeScanner.jsx` where shared, scan models, and `inventory-scan.css`.

**Acceptance:** signed-out scans return to the exact token after login; no unit data appears before authorization; camera fallback works with keyboard/paste; event order and identity are never visually conflated with aggregate Odoo stock.

## 7. Embedded module standards

Embedded workflows do not receive independent page shells. They follow these rules:

- The host owns `main`, outer gutters, and the top-level `h1`.
- The embedded workflow begins with `h2` or an accessible label appropriate to its region.
- Breadcrumbs appear only when the workflow replaces the host’s collection body with a nested task.
- Drawers preserve collection state and restore focus to the originating row.
- Dialogs use the shared modal/focus pattern and do not implement backdrop or Escape behavior independently.
- Workorder modules use the registry’s order, policy, and read/write state; they do not insert their own page headers.
- Loading and error state are local to the module unless the whole host is unusable.

## 8. Dedicated delivery sequence

Each numbered item is a separate implementation and rendered-review unit. Do not combine several pages into one broad CSS rewrite.

### Wave 0 — Shared owners proven by the live audit

1. Add executable foundation tokens for spacing, `4/6/8/12/999` radii, typography, color, control heights, borders/elevation, icon size, and motion; inventory and reject undocumented values in migrated owners.
2. Add `OperatorPage` variants with rendered `16/24/32px` gutters and task-appropriate maximum widths.
3. Extend `PageHeader` with semantic heading levels and `PageHeaderActions`: one phone primary action and a labeled overflow for secondary actions.
4. Render a shared component specimen covering controls, tabs, badges, cards, tables, settings rows, overlays, focus, motion, and all data states before page migration.
5. Add composition-level `CollectionToolbar` and use the existing Operations phone filter disclosure as the interaction reference.
6. Harden pagination and refresh owners: page reset/clamp, single-flight polling, stale-response protection, context preservation, and explicit background/stale/error states.
7. Add `RowActionsMenu`, `CompactResourceList`, and `SettingsRow` for repeated resource/settings collections.
8. Generalize the existing workorder detail surface into one neutrally named workorder workspace frame with explicit `create` and `detail` modes. Reuse the existing layout, object summary, section navigation, supporting pane, and responsive behavior; prevent title and fact duplication without merging draft and persisted-object state.
9. Build a reusable rendered page harness at `390px`, `768px`, `1440px`, and `1920px`, plus `320px` reflow, `200%` text, reduced motion, and forced-colors checks.

### Wave 1 — Two high-leverage composed-page migrations

10. Create and Workorder detail: route both through the shared workorder workspace frame, remove duplicated Create chrome, and prove draft/detail state and permissions remain separate.
11. Admin Operations: adopt the shared `OperatorPage`, `PageHeader`, `CollectionToolbar`, and collection-state contracts while preserving the existing responsive interaction model as the reference implementation.
12. Admin Inventory in `page` and Office `embedded` modes: compose the same operational collection frame and phone disclosure used by Operations; preserve inventory rows, counts, APIs, workflows, and contextual detail.

### Wave 2 — Remaining verified Admin inconsistencies

13. Location Users: search/filter, `88–104px` phone rows, one shared row-actions menu at every width, and removal of non-applicable placeholder noise.
14. Settings index and integration detail: remove one-item tabs and repeated provider identity; use compact phone resources, sequential headings, and focused settings sections.
15. Modules index and manager: compact the index and enter a focused object-detail mode after scope selection.
16. Location Work: preserve Operations behavior while removing the redundant fixed-location column.
17. Location Template: rebalance the desktop split and restore Preview access on phone.
18. Location Rules and Kiosk: focused settings width, aligned controls, and compact device rows.
19. Locations index: adopt shared owners, minimum type size, approved radii/depth, and improved information priority only.

### Wave 3 — Remaining core workflow duplication

20. Invoice intake: replace the long-page review with the bounded source canvas and guided review rail defined in Section 6.10; clarify immediate-upload language and preserve the separate receipt mutation.
21. Inventory files/count and Inventory part detail: polish existing nested/detail patterns without replacing `SecondaryDetailPanel`.
22. Inventory scan after its exact-unit live states are available.

### Wave 4 — Role convergence and remaining state gates

23. Preserve the completed local Admin, Office, Mechanic, Surveillance, sign-in, forgot-password, Odoo, and machine-client audit evidence; add exact viewport and state fixtures to the rendered harness.
24. Mechanic queues: enforce `20` on desktop, retain phone progression, and live-audit accepted/in-progress, Waiting, History, completion, and recovery states.
25. Office workorders hub: enforce `20` workorders and `20` mechanics per collection, then audit populated Parts and Drafts boundaries.
26. Surveillance queues and detail: enforce `20`, repair phone card collisions, and remove repeated identity/concern.
27. Standard sign in and forgot password: preserve the compact access pattern; audit invitation, valid reset, account-unavailable, and failure states.
28. Kiosk roster/unlock/PIN-change after a safe registered local Kiosk session is available.
29. Odoo and machine-client detail: remove repeated provider identity and paginate every repeated mapping/resource collection at `20`.

This order addresses the largest visible inconsistencies first while protecting the patterns that already work. A wave may be reprioritized for business urgency, but shared-owner dependencies, live role evidence, and one-page acceptance remain mandatory.

## 9. Definition of done for every page

A page is complete only when all applicable checks pass:

1. **Vision:** the implemented hierarchy matches its page brief and has one clear primary task.
2. **Ownership:** shared behavior remains in its canonical owner; no role-specific duplicate is introduced.
3. **Semantics:** one composed `h1`, sequential sections, correct landmarks, accessible names, and status announcements.
4. **States:** loading, refreshing, empty, filtered-empty, error, success, permission, and offline states are deliberate where applicable.
5. **Responsive:** rendered at `390px`, `768px`, and `1440px`; dense pages also at `1920px`; reflow checked at `320px` and `200%` text.
6. **Interaction:** keyboard order, visible focus, Escape/dismiss, focus restoration, and reduced motion are verified.
7. **Performance:** no blank route, avoidable layout shift, stale request overwrite, unbounded phone list, or interaction without immediate acknowledgement.
8. **Behavior:** APIs, permissions, role capability, inventory authority, draft lifecycle, and workflow state remain unchanged unless separately authorized.
9. **Tests:** focused owner contracts, cross-role tests where shared, production build, and appropriate browser workflow pass.
10. **Evidence:** before/after screenshots and a short acceptance record identify what was verified and what remains unavailable.
11. **Collections:** page size, visible fields, pagination, refresh, stale-data, and post-mutation behavior satisfy the collection/refresh contract.
12. **Precision:** gutters, radii, type floors, control/icon geometry, depth, contrast, and motion satisfy the precision critic plan without undocumented local exceptions.

The page-specific rendered gates in [Frontend Live UI Audit](./FRONTEND_LIVE_UI_AUDIT.md#7-rendered-acceptance-additions) are also mandatory. In particular, implementation review must prove Inventory heading/action behavior, compact User and Settings collections, phone Template Preview access, and removal of repeated object information.

## 10. Design review cadence

For each dedicated page unit:

1. Capture current rendered behavior and list the top three operator frictions.
2. Confirm the brief, real data available, role permissions, and preserved workflow.
3. Produce desktop, tablet, and phone composition notes before code changes.
4. Implement the smallest shared foundation or page-owner change.
5. Review hierarchy, density, language, accessibility, responsive behavior, and state quality.
6. Run focused automated checks and rendered browser acceptance.
7. Record screenshots, unresolved constraints, and the next page dependency.

Design review should reject pages that are merely cleaner but still unclear about scope, state, or next action. It should also reject visual consistency achieved through duplicated components or hidden domain behavior.

## 11. Repository and delivery constraints

- `frontend/src/app/routes/RoleRouter.jsx` remains orchestration only; page visuals do not move into it.
- `frontend/src/styles.css` remains an ordered import facade; new styles live with the narrowest canonical owner.
- Existing shared queue, detail, responsive filter, Preview, chat, and Inventory owners must be extended before creating alternatives.
- Current page, Inventory, Surveillance, detail, typography, and server files contain unrelated active edits. Reconcile current bytes and preserve those changes.
- Planning documents are not rendered evidence. Implementation status must be tracked separately from this intended-state blueprint.
- No commit, push, deployment, backend mutation, or production change is included in this plan.

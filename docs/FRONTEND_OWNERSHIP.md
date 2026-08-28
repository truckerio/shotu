# Frontend Ownership

This document defines where frontend behavior belongs. New work should extend the
listed owner instead of adding a role-specific copy to a workspace or router.

## Route orchestration

- `frontend/src/app/App.jsx` chooses the authenticated role shell.
- `frontend/src/app/routes/RoleRouter.jsx` coordinates route-level data and hands
  it to feature pages. It is capped below 500 lines and must not absorb new
  visual components, API operations, derived projections, or feature
  controllers.
- `frontend/src/app/routes/route-state.js` owns URL parsing and updates.
- `frontend/src/app/routes/useRoleRouteNavigation.js` owns browser navigation
  callbacks and section changes used by the route coordinator.
- `frontend/src/app/routes/role-capabilities.js` is the canonical role capability
  registry. Feature pages consume capabilities instead of branching on role names.
- `frontend/src/app/routes/role-router-api.js` owns route-level HTTP operations.
- `frontend/src/app/routes/role-router-model.js` owns pure form and preview
  projections.
- `frontend/src/app/routes/RoleWorkspaceOutlet.jsx` owns role workspace/page
  composition.
- `frontend/src/app/routes/useWorkorderDetailRoute.js` owns detail hydration and
  opening from URL state.
- `frontend/src/app/routes/useWorkorderDetailViewModel.js` owns derived detail
  presentation state; `workorder-detail-view-model.js` owns its pure projections.
- `frontend/src/app/routes/useRoleRouterFormController.js` owns shared form,
  parts, and edit-autosave commands.
- `frontend/src/app/routes/useRoleRouterCommands.js` owns create, draft-leave,
  and return-navigation commands.
- `frontend/src/app/routes/useRoleRouterLifecycleEffects.js` owns route-level
  realtime, map configuration, canonical-time, and recovery effects.

The coordinator may wire these owners together, but it must not duplicate their
logic. Runtime imports used only after navigation still need browser workflow
coverage; a production build alone does not prove those paths execute.

## Shared workorder detail

- `frontend/src/features/workorder-detail/WorkorderDetailPage.jsx` owns the
  shared detail shell, header, main sections, and supporting pane slots.
- `frontend/src/features/workorder-detail/useWorkorderDetailRealtime.js` owns
  realtime detail subscription behavior.
- `frontend/src/features/workorder-detail/workorder-detail-loader.js` owns the
  role-aware detail API selection and normalized detail loading contract.
- `frontend/src/features/workorder-detail/useWorkorderPreviewController.js`
  owns responsive Preview/Chat pane state, fullscreen Preview, and URL section
  synchronization.
- Role-specific actions are passed into the shared page. A role must not create
  a second detail layout.

## Feature owners

- Admin shell and data orchestration: `frontend/src/features/admin/AdminWorkspace.jsx`
- Admin pages and dialogs: `frontend/src/features/admin/workspace/`
- Office queues: `frontend/src/features/office/`
- Invoice extraction/review, source viewer, and explicit physical-receipt attestation: `frontend/src/features/office/InvoiceExtractionWorkspace.jsx`, `InvoiceDocumentViewer.jsx`, `PhysicalReceiptConfirmation.jsx`, and their colocated model/CSS/test files.
- Shared local-inventory workspace, count import, scan surface, and exact-unit workflows: `frontend/src/features/inventory/InventoryWorkspace.jsx`, `InventoryCountImportPanel.jsx`, `InventoryScanWorkspace.jsx`, `GetPartsFlow.jsx`, and colocated model/CSS/test files. The workspace is embedded by both Office and Admin; do not create separate role copies.
- Office detail mutations and autosave: `frontend/src/features/office/useOfficeWorkorderActions.js`
- Mechanic queues and mechanic-only behavior: `frontend/src/features/mechanic/`
- Mechanic detail lifecycle, chat, and navigation actions: `frontend/src/features/mechanic/useMechanicWorkorderActions.js`
- Surveillance orchestration: `frontend/src/features/surveillance/SurveillanceWorkspace.jsx`
- Surveillance queue/detail/Odoo surfaces: `frontend/src/features/surveillance/workspace/`
- Shared part-request entry point: `frontend/src/components/workorders/PartRequestsPanel.jsx`
- Part-request role surfaces and state: `frontend/src/components/workorders/part-requests/`
- Shared queue styles: `frontend/src/components/workorders/workorder-queue.css`
- Shared part-request styles: `frontend/src/components/workorders/part-requests/legacy-part-requests.css`
- Shared chat: `frontend/src/components/workorders/chat/`
- Shared timeline: `frontend/src/components/workorders/WorkorderTimeline.jsx` and `workorder-timeline.css`
- Shared Preview: `frontend/src/components/preview/`
- Shared map styles: `frontend/src/lib/maps/`
- Role-home styles: `frontend/src/features/mechanic/mechanic-workspace.css` and
  `frontend/src/features/office/office.css`
- Create-workorder draft lifecycle: `frontend/src/features/create-workorder/useWorkorderDraftLifecycle.js`
- Create-workorder vehicle lookup: `frontend/src/features/create-workorder/useVehicleLookupController.js`
- Create-workorder location, template, and location-scoped mechanic loading:
  `frontend/src/features/create-workorder/useCreateLocationController.js`
- Workorder browser print, archive, and print-status lifecycle:
  `frontend/src/features/create-workorder/useWorkorderPrintController.js`

## Styling

`frontend/src/styles.css` is an ordered import facade. `legacy-workspaces.css`
and `responsive-overlays.css` are import-only compatibility boundaries, not
style owners. Add styles beside the narrowest owning component or feature. Do
not rebuild a single global stylesheet. Import order is a compatibility
contract; see `frontend/src/styles/README.md` before moving rules.

## Verification rules

- Source-ownership tests must read the actual owner, not a compatibility wrapper.
- Any new nested test directory must be included by `npm run test:unit`.
- Shared behavior needs one contract test at the shared owner plus focused role
  tests for capability differences.
- Responsive changes require phone, tablet, and desktop checks for overflow,
  focus, keyboard interaction, and stable component geometry.
- CSS ownership slices must pass `frontend/src/features/workorder-detail/css-ownership-contract.test.js`
  and the four-size Playwright harness in `scripts/visual/css-ownership-viewport.js`.
- Cross-role route changes must pass `npm run test:role-workflow`; browser role
  assertions run sequentially to reflect normal sign-in behavior and avoid
  artificial rate-limit contention.

## QA accounts

Use the controlled account workflow in `docs/QA_ACCOUNTS.md`. Do not place demo
credentials in source, migrations, startup code, or documentation.

# Frontend Ownership

This document defines where frontend behavior belongs. New work should extend the
listed owner instead of adding a role-specific copy to a workspace or router.

## Route orchestration

- `frontend/src/app/App.jsx` chooses the authenticated role shell.
- `frontend/src/app/routes/RoleRouter.jsx` coordinates route-level data and hands
  it to feature pages. It must not absorb new visual components.
- `frontend/src/app/routes/route-state.js` owns URL parsing and updates.
- `frontend/src/app/routes/role-router-api.js` owns route-level HTTP operations.
- `frontend/src/app/routes/role-router-model.js` owns pure form and preview
  projections.

## Shared workorder detail

- `frontend/src/features/workorder-detail/WorkorderDetailPage.jsx` owns the
  shared detail shell, header, main sections, and supporting pane slots.
- `frontend/src/features/workorder-detail/useWorkorderDetailRealtime.js` owns
  realtime detail subscription behavior. Route-level detail loading remains in
  `RoleRouter.jsx` until it can move without changing the shared API contract.
- `frontend/src/features/workorder-detail/useWorkorderPreviewController.js`
  owns responsive Preview/Chat pane state, fullscreen Preview, and URL section
  synchronization.
- Role-specific actions are passed into the shared page. A role must not create
  a second detail layout.

## Feature owners

- Admin shell and data orchestration: `frontend/src/features/admin/AdminWorkspace.jsx`
- Admin pages and dialogs: `frontend/src/features/admin/workspace/`
- Office queues: `frontend/src/features/office/`
- Mechanic queues and mechanic-only behavior: `frontend/src/features/mechanic/`
- Surveillance orchestration: `frontend/src/features/surveillance/SurveillanceWorkspace.jsx`
- Surveillance queue/detail/Odoo surfaces: `frontend/src/features/surveillance/workspace/`
- Shared part-request entry point: `frontend/src/components/workorders/PartRequestsPanel.jsx`
- Part-request role surfaces and state: `frontend/src/components/workorders/part-requests/`
- Shared chat: `frontend/src/components/workorders/chat/`
- Shared timeline: `frontend/src/components/workorders/WorkorderTimeline.jsx`
- Shared Preview: `frontend/src/components/preview/`

## Styling

`frontend/src/styles.css` is an ordered import facade. Add styles to the narrowest
feature stylesheet under `frontend/src/styles/` or beside the owning component.
Do not rebuild a single global stylesheet. Import order is a compatibility
contract; see `frontend/src/styles/README.md` before moving rules.

## Verification rules

- Source-ownership tests must read the actual owner, not a compatibility wrapper.
- Any new nested test directory must be included by `npm run test:unit`.
- Shared behavior needs one contract test at the shared owner plus focused role
  tests for capability differences.
- Responsive changes require phone, tablet, and desktop checks for overflow,
  focus, keyboard interaction, and stable component geometry.

## QA accounts

Use the controlled account workflow in `docs/QA_ACCOUNTS.md`. Do not place demo
credentials in source, migrations, startup code, or documentation.

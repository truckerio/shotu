# Admin Modules

This folder owns the admin-facing module catalog and access editor.

## Boundaries

- `ModulesPage.jsx` owns compact discovery, role controls, and named-user exceptions.
- `module-admin-model.js` adapts the company-default, location-override, and named-user policy layers for the UI.
- `modules.css` owns only the Modules destination styles.
- The canonical module catalog, defaults, and access resolution remain in `shared/workorder-modules.js`.
- Server authorization and persistence remain outside this frontend feature.
- Audit storage and audit-history UI are intentionally not owned here.

New module cards appear from the shared catalog automatically. Do not add a
second module editor elsewhere: Location Rules and per-user actions navigate to
this page as shortcuts.

The access selector stays limited to Off, View, and Edit. Edit is available for
every role or user when the canonical catalog declares a write-capable module;
legacy role defaults do not cap Admin configuration. Create-only required
validation is a separate setting. Company and location policies remain sparse
so inherited access keeps its source and can be reset cleanly.

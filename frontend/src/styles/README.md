# Global CSS ownership

`../styles.css` is the single application-level CSS entry point. Its imports are
ordered to preserve the historical cascade and must stay in that order unless a
visual regression pass proves otherwise.

- `foundation.css`: design tokens, reset rules, page canvas, and base typography.
- `legacy-workspaces.css`: import-only compatibility facade for the former
  workspace bundle. It must contain no declarations.
- `../components/workorders/part-requests/legacy-part-requests.css`: transitional part-request declarations extracted from the tail of `legacy-workspaces.css`. It must remain immediately after that import until its selectors are consolidated into the component's primary stylesheet.
- `responsive-overlays.css`: import-only compatibility facade for the former
  responsive bundle. It must contain no declarations.
- `../components/preview/legacy-responsive-preview.css`: transitional phone Preview/fullscreen declarations extracted from the final responsive block. It must remain immediately after `responsive-overlays.css` to preserve the historical cascade.
- `../components/workorders/chat/chat.css`: shared chat thread, attachment, composer, delivery receipt, phone, and keyboard behavior. Chat styling has one owner across roles.
- `../components/workorders/workorder-timeline.css`: shared activity/timeline presentation, participants, Preview-dock containment, and responsive timeline behavior.
- `../components/workorders/workorder-queue.css`: shared queue shell, tabs, search, workorder rows, empty states, role variants, and responsive queue behavior.
- `../features/mechanic/mechanic-workspace.css`: mechanic home composition and role-only controls.
- `../features/office/office.css`: office home, mechanic workload panel, filters, and office-only responsive composition.
- `../components/workorders/legacy-workspace-controls.css`: shared workspace controls and status presentation.
- `../features/workorder-detail/workorder-detail-toolbar.css`: shared detail toolbar and Preview toggle presentation.
- `../features/create-workorder/create-workorder-editor.css`: create editor, assignment, and section presentation.
- `../components/forms/legacy-form-controls.css`: shared form controls retained from the old bundle.
- `../components/workorders/legacy-used-parts-editor.css`: shared used-parts editor presentation.
- `../lib/maps/legacy-asset-map*.css`: shared asset location and map presentation.
- `../components/preview/legacy-preview-layout.css` and `legacy-printable-document.css`: Preview shell, fullscreen, and printable document presentation.
- `../components/workorders/legacy-responsive-split.css`: responsive shared split-pane layout.
- `mechanic-detail.css`: transitional mechanic-detail rules awaiting feature-local ownership.
- `create-workorder.css`: shared create-workorder composition rules.
- `workorder-detail.css`: shared workorder object/detail composition and responsive behavior.
- `print.css`: browser print visibility rules.

New component or feature styles belong beside their owning JSX. Only reset,
tokens, application shell, and genuinely cross-feature composition should be
added under this directory.

For a safe ownership move, extract a contiguous tail at an existing import
boundary. Add an ownership contract and run `scripts/visual/css-ownership-viewport.js`
at the four supported viewport classes before moving another slice.

The compatibility declarations in `../styles.css` mirror imported rules for
source-level regression tests that intentionally read the entry file directly.

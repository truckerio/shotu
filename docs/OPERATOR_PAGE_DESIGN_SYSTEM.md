# Operator Page Design System

- **Status:** Approved implementation contract
- **Scope:** Admin Operations, Inventory, Locations, Location detail, and Inventory embedded in Office
- **Intent:** Make related operator pages feel like one premium product without flattening their domain-specific workflows.
- **Page-level roadmap:** [Frontend Experience Vision and Page Delivery Roadmap](./FRONTEND_PAGE_VISION_AND_ROADMAP.md)
- **Rendered evidence:** [Frontend Live UI Audit](./FRONTEND_LIVE_UI_AUDIT.md)
- **Collection behavior:** [Frontend Collection, Data Density, and Refresh Contract](./FRONTEND_COLLECTION_REFRESH_CONTRACT.md)
- **Precision critic review:** [Frontend UI/UX Critique and Precision Polish Plan](./FRONTEND_UI_UX_CRITIQUE_AND_POLISH_PLAN.md)

## 1. Product principles

The operator UI follows three principles adapted from Apple’s Human Interface Guidelines:

1. **Clarity:** hierarchy, labels, focus, and the next action are obvious.
2. **Deference:** data and work take priority over decorative chrome.
3. **Depth:** layering communicates structure only when a surface actually overlaps another surface.

For this industrial operations product, “premium” means precise proportions, consistent behavior, restrained color, and reliable states. It does not mean glass effects, ornamental gradients, or shadows around every section.

The shared system owns page geometry and interaction conventions. Each domain continues to own its data model, filters, columns, row actions, permissions, and API behavior.

## 2. Research basis

This contract combines the existing product visual language with established system guidance:

- [Atlassian spacing](https://atlassian.design/foundations/spacing) and [Carbon spacing](https://carbondesignsystem.com/elements/spacing/overview/) support a small, named spacing scale rather than page-local values.
- [Atlassian corner radius](https://atlassian.design/foundations/radius/) and [elevation](https://atlassian.design/foundations/elevation) support using radius and shadow according to a surface’s role.
- [Carbon data-table guidance](https://carbondesignsystem.com/components/data-table/usage/) supports stable row geometry, clear table hierarchy, and task-appropriate density.
- [Carbon color and layering](https://carbondesignsystem.com/elements/color/overview/) supports neutral layered surfaces and semantic color reserved for meaning.
- [Apple accessibility guidance](https://developer.apple.com/design/human-interface-guidelines/accessibility) and [WCAG 2.2 target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) inform touch targets, focus, reflow, and text resilience.

These sources are inputs, not alternate design systems. Existing brand color and application behavior remain authoritative unless this contract explicitly changes them.

## 3. Foundation tokens

New page and collection work must consume named tokens. A component may use a local value only when the difference expresses a documented domain need.

### 3.1 Spacing

| Token | Value | Primary use |
| --- | ---: | --- |
| `--space-1` | `4px` | Optical adjustment, icon/text gap |
| `--space-2` | `8px` | Tight control and metadata gap |
| `--space-3` | `12px` | Compact cell and field gap |
| `--space-4` | `16px` | Standard component padding |
| `--space-5` | `20px` | Dense section separation |
| `--space-6` | `24px` | Standard section separation |
| `--space-8` | `32px` | Desktop page gutter and major separation |
| `--space-10` | `40px` | Large composition separation |
| `--space-12` | `48px` | Empty-state and major vertical spacing |
| `--space-16` | `64px` | Exceptional large-screen separation |

Page gutters are fixed by viewport class:

- Phone, up to `640px`: `16px`
- Tablet, `641px` through `1024px`: `24px`
- Desktop, `1025px` and wider: `32px`

Do not nest a second page gutter inside a shared page wrapper. Embedded content inherits its host’s horizontal padding.

### 3.2 Width

| Content type | Maximum width |
| --- | ---: |
| Dense operational collections | `1920px` |
| Forms, settings, and focused workspaces | `1280px` |
| Long-form explanatory copy | `720px` |

Collections should use available space below their maximum. Narrow fixed-width tables that create unused desktop space are not acceptable.

### 3.3 Radius, borders, and elevation

| Token | Value | Use |
| --- | ---: | --- |
| `--radius-badge` | `4px` | Status chips with compact geometry |
| `--radius-control` | `6px` | Inputs, buttons, segmented controls |
| `--radius-surface` | `8px` | Tables, cards, inline panels |
| `--radius-overlay` | `12px` | Drawers, dialogs, large floating panels |
| `--radius-pill` | `999px` | True pills, counters, avatars only |

Inline surfaces use a neutral background and a `1px` subtle border. They do not use shadows. Menus, popovers, drawers, and dialogs may use one shared overlay shadow because they occupy a higher layer.

### 3.4 Typography

| Role | Desktop | Phone | Weight |
| --- | --- | --- | ---: |
| Page title | `24px / 30px` | `22px / 28px` | `650` |
| Section title | `18px / 26px` | same | `600` |
| Body and controls | `14px / 20px` | same | `400–600` |
| Secondary metadata | `13px / 18px` | same | `400–500` |
| Caption and labels | `12px / 16px` | same | `500–600` |

Titles use sentence case. Operational identifiers, counts, currency, measurements, and dates use tabular numerals where alignment matters. Color alone never communicates state.

### 3.5 Controls

- Standard desktop control height: `40px`.
- Phone and high-frequency touch control height: at least `44px`.
- Icon-button width equals its height.
- Minimum gap between adjacent controls: `8px`.
- Inputs and buttons use the control radius.
- A page has no more than one visually primary action in its header.
- Icon-only actions require an accessible name and a visible tooltip where the icon is not universally understood.

## 4. Canonical page anatomy

Every top-level operator page follows this order. Optional regions disappear without leaving spacer elements.

1. Application workspace header and primary navigation
2. `OperatorPage` content wrapper
3. `PageHeader`
4. Local tabs, when the page has stable subviews
5. Filter and action toolbar
6. Result summary or current operational state
7. Collection or task surface
8. Pagination or continuation controls
9. Existing phone bottom navigation, when applicable

### 4.1 Page header geometry

The page header contains:

- Optional breadcrumbs in a leading row
- One semantic page title
- Optional one-line description
- A trailing action group

Spacing rules:

- Breadcrumbs to title: `8px`
- Title to description: `4px`
- Header text group to following tabs or toolbar: `24px`
- Header action gap: `8px`
- Desktop title/action alignment: first baseline when practical, otherwise top aligned
- Phone layout: text first, actions below with `16px` separation; primary action may become full width

Descriptions should explain scope or current state, not repeat the title. Avoid persistent instructional paragraphs when a label or empty state can communicate the same information.

### 4.2 Presentation variants

The shared wrapper must expose explicit presentation semantics rather than infer them from role or route.

| Variant | Heading | Landmark and gutters | Use |
| --- | --- | --- | --- |
| `page` | One `h1` | Owns page content geometry | Admin Operations, Inventory, Locations |
| `detail` | One `h1` plus breadcrumbs; local sections start at `h2` | Owns page content geometry | Location detail |
| `embedded` | Starts at `h2` | No duplicate main landmark; inherits host geometry | Inventory inside Office |

The Inventory feature must remain one domain implementation. Admin and Office pass different presentation variants; they do not fork the feature or duplicate its styling.

## 5. Collection surfaces

Operations, Inventory, and Locations share collection proportions but retain different columns, filters, and actions.

Every collection shows `20` records by default. Additional records use pagination or progressive increments of `20`, following the collection and refresh contract. Fewer than `20` records render without empty filler rows.

### 5.1 Toolbar

- Toolbar controls are `40px` high on desktop and `44px` on phone.
- Search takes remaining row width, up to a practical maximum of `480px`.
- Filters and secondary actions follow search.
- The result count is visible near filters or immediately above the collection.
- On phone, search occupies its own row. Lower-priority actions move into a labeled overflow menu.
- Applying a filter must not move keyboard focus unexpectedly.

### 5.2 Desktop table

| Element | Geometry |
| --- | --- |
| Header row | `40px` minimum height |
| Compact single-line row | `52px` minimum height |
| Two-line operational row | `64px` minimum height |
| Cell padding | `12px` vertical, `16px` horizontal |
| Header label | `12px / 16px`, semibold |
| Primary cell text | `14px / 20px` |
| Secondary cell text | `13px / 18px` |

Columns align by data type: text left, amounts and quantities right, compact status centered only when that improves scanning. Row selection, navigation, and inline buttons must not compete for the same click target.

The first implementation pass must not force all domains into `OperationalDataTable`. Reuse a shared collection component only after the pages demonstrate genuinely identical structure and behavior.

### 5.3 Phone collection

Tables may become cards when horizontal scrolling would hide the identity or next action.

- Card padding: `16px`
- Field gap: `12px`
- Card-to-card gap: `12px`
- Primary identity appears first.
- Status and next action remain visible without expansion.
- Secondary metadata may use progressive disclosure.
- A card cannot reproduce every desktop column merely to claim parity.

## 6. Surface and color rules

- The application page uses the existing neutral canvas.
- Primary work surfaces are white with a subtle border.
- Blue is reserved for primary actions, links, selection, and focus.
- Green, amber, red, and neutral gray are reserved for semantic state.
- Status colors require accompanying text or iconography.
- Avoid stacked bordered cards. Prefer spacing and headings inside an already bounded surface.
- Avoid translucency behind dense operational data. It reduces contrast and makes the hierarchy less stable.

## 7. Responsive behavior

Responsive behavior is based on content pressure, with these shared validation classes:

- Phone: `390px`
- Tablet: `768px`
- Desktop: `1440px`
- Wide operations desktop: `1920px`

Every page must also reflow at `320px` CSS width without losing content or requiring two-dimensional page scrolling. At `200%` text zoom, controls may wrap or stack; they must not overlap, clip labels, or hide actions.

Desktop-only density is allowed when the same task has a deliberate phone representation. Hiding a table without providing the identity, state, and next action on phone is not responsive behavior.

## 8. Interaction and accessibility contract

The pages target WCAG 2.2 AA and must satisfy all of the following:

- One `h1` on each composed top-level page; headings do not skip levels.
- The app shell, not each feature component, owns the main landmark and bypass navigation.
- All controls are keyboard reachable in a logical order.
- Focus is visibly indicated with a shared high-contrast focus ring.
- Opening and closing a menu, drawer, or dialog manages and restores focus.
- Visible form labels are the default; placeholder text is not a label.
- Related radio or checkbox groups use `fieldset` and `legend` where semantically appropriate.
- Dynamic success, error, and refresh messages use appropriate status or alert semantics without excessive announcements.
- Text contrast is at least `4.5:1`; large text at least `3:1`; meaningful UI boundaries and focus indicators at least `3:1` against adjacent colors.
- Desktop controls never fall below the WCAG `24px` minimum target; phone and frequent operational controls use the stronger `44px` product target.
- Reduced-motion preferences remove nonessential motion.
- Loading, empty, error, disabled, and permission-denied states remain understandable without color.

Static component scanners provide leads, not acceptance. Component fragments can legitimately lack the app shell’s `main`, skip link, or page heading. Findings are accepted only after checking the composed page and rendered interaction.

## 9. State design

Every collection and detail surface defines the following states:

- **Initial loading:** a stable skeleton or reserved geometry; no layout jump from a centered spinner.
- **Refreshing:** retain usable current data and show a quiet progress state.
- **Empty:** state what is empty, why when known, and offer the next valid action.
- **Filtered empty:** distinguish “no matches” from “no records” and offer clear filters.
- **Error:** plain-language cause when known, one recovery action, and persistent access to safe navigation.
- **Success:** confirm completed mutations near the action or in a restrained status region.
- **Permission denied:** explain unavailable scope without rendering controls that can never succeed.

## 10. Code ownership

The implementation should establish these canonical owners:

- `frontend/src/components/layout/OperatorPage.jsx` and its CSS: page gutters, width, vertical rhythm, and presentation variant.
- `frontend/src/components/layout/PageHeader.jsx` and its CSS: breadcrumbs, semantic title level, description, and action layout.
- `frontend/src/styles/foundation.css`: shared spacing, radius, control, and width tokens.
- `frontend/src/typography.css`: shared typography roles only where the existing definitions do not already satisfy this contract.

Domain owners remain:

- Admin composition: `frontend/src/features/admin/workspace/OperationsPage.jsx`, `LocationsPage.jsx`, and `AdminWorkspaceShell.jsx`
- Inventory behavior: `frontend/src/features/inventory/InventoryWorkspace.jsx`
- Operations behavior: `frontend/src/components/operations/OperationsWorkspace.jsx`
- Office composition: `frontend/src/features/office/OfficeWorkspace.jsx`

Shared primitives must accept explicit semantics and composition props. They must not inspect route names, user roles, or domain data to decide presentation.

## 11. Current audit baseline

The source and rendered-page audit found a shared visual language but different page composition:

| Surface | Current composition | Audit finding |
| --- | --- | --- |
| Admin Operations | `admin-content` and shared `PageHeader` around the operations feature | Closest to the intended page template; collection geometry remains domain-local. |
| Locations list | `admin-content` and shared `PageHeader` | Generally aligned with Operations, but page and collection spacing still come from broad Admin CSS. |
| Location detail | Shared header plus breadcrumbs, tabs, and detail panels | Correctly needs a `detail` variant; tabs and operational sections should remain domain-specific. |
| Admin Inventory | Custom `inventory-workspace`, local heading, and its own white surface | Diverges in title semantics, outer padding, radius, surface hierarchy, and header-to-content rhythm. |
| Office Inventory | The same Inventory feature embedded in the Office workspace | Confirms the feature needs explicit `page` and `embedded` presentation instead of a role-specific copy. |

The largest rendered mismatch is Inventory: its custom header and container create a visibly different page start, and the difference grows on phone where the header consumes more vertical space. Operations and Locations should provide the initial geometry reference, but their current arbitrary values are not automatically promoted to tokens; the values in this contract are the target.

Keep the useful differences: Location detail tabs, Inventory scanning and count workflows, Operations-specific filters and actions, and each domain’s responsive information priorities. Standardize the page shell, title hierarchy, gutters, surface treatment, control proportions, state behavior, and validation rules.

## 12. File-aware implementation plan

### Phase 1 — Foundation and page primitives

1. Add the approved tokens to `frontend/src/styles/foundation.css`, reusing compatible existing variables instead of creating aliases with different values.
2. Add `OperatorPage.jsx` and its stylesheet for `page`, `detail`, and `embedded` geometry.
3. Extend `PageHeader.jsx` and `page-header.css` to implement the contract without breaking current callers.
4. Add focused contract tests for semantic heading level, breadcrumbs, actions, and variant behavior.

**Exit:** a test harness renders all three variants at phone, tablet, and desktop widths with identical outer geometry.

### Phase 2 — Admin page adoption

1. Migrate `OperationsPage.jsx` and `LocationsPage.jsx` to `OperatorPage` plus the shared `PageHeader` contract.
2. Keep location-detail breadcrumbs and tabs as the `detail` variant.
3. Remove superseded page-padding, header, and surface rules from `frontend/src/features/admin/admin.css` only after every caller is migrated.
4. Update `frontend/src/features/admin/workspace/admin-workspace-ownership.test.js` to assert canonical composition and prevent new local page shells.

**Exit:** Operations, Locations list, and Location detail share title position, gutters, max width, and header-to-content rhythm at all validation widths.

### Phase 3 — Inventory page and embedded adoption

1. Refactor `InventoryWorkspace.jsx` to accept an explicit `presentation` contract without changing inventory behavior or data ownership.
2. Admin passes `page`, producing the single page `h1` and canonical gutters.
3. Office passes `embedded`, producing an `h2`, no duplicate page landmark, and inherited host padding.
4. Reconcile and simplify `inventory-workspace.css`; preserve only domain-specific collection, scan, filter, and state styling.
5. Update inventory and Office contract tests for both compositions.

**Exit:** Inventory looks native in both hosts, with one implementation and correct heading semantics in each composed page.

### Phase 4 — Collection rhythm and responsive states

1. Align toolbars, result summaries, tables, cards, pagination, and empty/error states to Sections 5–9.
2. Update `frontend/src/components/operations/operations.css`, `frontend/src/features/admin/admin.css`, and `frontend/src/features/inventory/inventory-workspace.css` within their domain boundaries.
3. Extract a shared collection surface only where at least two migrated domains have the same markup and interaction contract.
4. Preserve domain-specific columns, row actions, filters, scan workflows, and permissions.

**Exit:** collection surfaces share proportions and state quality without a forced universal table abstraction.

### Phase 5 — Rendered acceptance and cleanup

1. Validate composed pages at `390px`, `768px`, `1440px`, and `1920px`.
2. Validate `320px` reflow and `200%` text zoom.
3. Exercise keyboard navigation, visible focus, menu/dialog focus return, reduced motion, and status announcements.
4. Compare before/after screenshots for hierarchy, density, unused space, and mobile action access.
5. Remove superseded selectors only after repository search proves they have no remaining callers.
6. Run focused tests and the production frontend build; distinguish scoped failures from unrelated baseline failures.

**Exit:** rendered evidence and automated contracts support each acceptance criterion below.

## 13. Acceptance criteria

| ID | Requirement |
| --- | --- |
| `PAGE-01` | Operations, Inventory, Locations, and Location detail use the canonical page wrapper and header. |
| `PAGE-02` | Page title, description, actions, and first content surface align to the same desktop and phone geometry. |
| `PAGE-03` | Admin Inventory and Office Inventory use one feature implementation with explicit `page` and `embedded` semantics. |
| `PAGE-04` | Every composed top-level page has one `h1`; embedded Inventory begins at `h2`. |
| `PAGE-05` | Page gutters are `16px`, `24px`, and `32px` for the defined viewport classes. |
| `PAGE-06` | Desktop controls are at least `40px`; phone and frequent operational controls are at least `44px`. |
| `PAGE-07` | Inline surfaces use border and neutral layering without decorative shadows. |
| `PAGE-08` | Collection rows and cards follow the defined density while preserving domain-specific information. |
| `PAGE-09` | Loading, refreshing, empty, filtered-empty, error, success, and permission states have deliberate treatments. |
| `PAGE-10` | Pages reflow at `320px` and remain operable at `200%` text zoom. |
| `PAGE-11` | Keyboard, focus, contrast, naming, live-region, and reduced-motion checks pass at the composed-page boundary. |
| `PAGE-12` | No API, permission, inventory-authority, or operational workflow behavior changes as a side effect of visual unification. |
| `PAGE-13` | Migrated owners use only the approved `4/6/8/12/999` radius ladder unless a documented geometry exception is accepted. |
| `PAGE-14` | Meaningful onscreen operational text is at least `12px`; table/body data remains `13–14px`. |
| `PAGE-15` | Inline surfaces use borders without decorative shadows; only real overlays use elevation. |
| `PAGE-16` | Rendered page gutters are `16px`, `24px`, and `32px` at phone, tablet, and desktop classes. |

## 14. Delivery constraints

- Implement in the phase order above and keep each change reviewable.
- Reconcile the current bytes before editing: relevant page and inventory files may already contain active local work.
- Preserve unrelated dirty files and never replace a whole stylesheet merely to normalize formatting.
- Do not modify backend APIs, database schema, Odoo authority, or permission policy for this design-system migration.
- Do not claim completion from source inspection alone. Final acceptance requires rendered evidence from the composed application.

# Frontend Live UI Audit

- **Date:** August 28–29, 2026
- **Runtime:** Local application at `http://localhost:4173`
- **Purpose:** Replace source-only design assumptions with rendered evidence and identify the shared components that will produce the largest product-wide improvement.
- **Mutation boundary:** Navigation, filtering, opening drawers, and opening non-destructive detail surfaces only. No workorder was submitted, no settings were saved, and no provider action was run.

## 1. Evidence boundary

The first live pass used Admin Demo. A second pass created controlled local-only QA identities through the repository's Better Auth account manager and signed in sequentially as Admin, Office, Mechanic, and Surveillance. The second pass added rendered inspection of:

- Admin Operations
- Admin Inventory, Inventory files, Invoice intake, and part detail
- Locations index
- Location Work, Users, Template, Rules, and Kiosk
- Modules index and module manager
- Settings index and Samsara detail
- Create workorder
- Shared Admin/Office-style workorder detail
- Invalid/expired password-reset state
- Office home, embedded Inventory, Create, populated detail, and Invoice review
- Mechanic My work, Available jobs, and an unaccepted workorder detail
- Surveillance Active, Awaiting office, Needs Odoo, Missing info, Entered, and populated detail
- Standard sign in and the forgot-password dialog
- Odoo and machine-client integration detail

The browser was requested at desktop `1440 × 900`, tablet `768 × 1024`, and phone `390 × 844`. Its host scale reported effective CSS viewports of approximately `1600 × 1000`, `853 × 1138`, and `433 × 938`. The audit therefore proves desktop-, tablet-, and phone-class behavior, but it does not claim exact breakpoint acceptance. Exact `390px`, exact `768px`, exact `1440px`, exact `320px`, and `200%` text remain required implementation gates.

The following states still require safe live evidence:

- Mechanic accepted/in-progress, Waiting, completed History, and completion/recovery actions
- Office Parts and Drafts with representative non-empty records
- Kiosk roster and unlock/PIN-change flow
- Valid invitation and valid password-reset flows
- Account-unavailable, offline, request-failure, permission-denied, and stale-refresh states
- Exact breakpoint, `200%` text, reduced-motion, and forced-colors acceptance

These unverified surfaces remain planned, not accepted. Existing source contracts and prior screenshots do not replace this live pass.

Opening Create workorder resolved to draft `055b2394-3a3a-4796-8b8a-2e6ac691e584`; the UI reported it as saved and then restored after reload. It was not submitted, changed, discarded, or deleted.

## 2. Bottom line

The product already has a strong restrained visual direction. Its main problem is not color or branding; it is inconsistent composition and too much repeated information. Five shared changes will create most of the premium effect:

1. One page shell and header contract across Admin and embedded contexts.
2. One responsive action/filter contract, using Operations phone behavior as the starting point.
3. One compact resource-list pattern for Users, Modules, Settings, and devices.
4. One object-page header and summary contract that removes repeated titles and facts.
5. One settings/detail composition with focused maximum width and no single-tab or duplicate-card chrome.

Do not begin with a global visual restyle. Preserve the rendered patterns that already work and replace the repeated structural problems.

## 3. Shared-component findings

### `LIVE-P0-01` — Page shell and heading semantics diverge

**Rendered evidence**

- Locations and Operations use the Admin shell, `PageHeader`, neutral canvas, and approximately `28px` desktop content padding.
- Inventory starts at the shell edge as a full white bordered surface with `14px` radius and `20px` internal padding.
- Admin Inventory renders “Parts inventory” as `h2`; the composed Admin page has no `h1`.
- On phone, the Inventory header measured about `150px` high while the Operations page header measured about `81px`.

**Required shared change**

Add `OperatorPage` with explicit `page`, `detail`, and `embedded` variants. Extend `PageHeader` with semantic heading level, breadcrumbs, description, primary action, secondary actions, and phone overflow behavior. Inventory must use `h1` in Admin and `h2` when embedded in Office.

**Do not do**

Do not make every page a white rounded card. The neutral page canvas plus bounded task/collection surfaces already looks cleaner on Operations and Locations.

### `LIVE-P0-02` — Header actions need one responsive owner

**Rendered evidence**

- Operations phone shows one clear Create workorder action and moves queue filters behind a `44px` control.
- Inventory phone stacks Invoice, Count, and an icon-only Refresh control in a right-side action column, producing the `150px` header and an awkward unlabeled visual hierarchy.
- Location Users makes Invite user full width on phone, while other page actions use different placement rules.

**Required shared change**

Create a `PageHeaderActions` behavior inside `PageHeader`:

- Desktop: one primary action plus visible secondary actions.
- Phone: one primary action; remaining actions in a labeled overflow menu.
- Icon-only actions: accessible name, tooltip on pointer devices, and `44px` touch target.

Inventory should present one explicit primary action such as “Add invoice” and place Count/Refresh in secondary actions. If clicking the action immediately opens upload, its label must say so.

### `LIVE-P0-03` — Collection filters are not shared

**Rendered evidence**

- Operations phone reduces eight desktop queues to three primary queues and moves search/filter controls into the shared mobile filter surface.
- Inventory phone renders Search, Inventory view, four availability buttons, Sort, and result state before the first row. Only a small number of stock rows remain visible in the initial viewport.
- Invoice intake separately stacks Search and Status above its cards.

**Required shared change**

Extract a composition-level `CollectionToolbar`, not a universal data model:

- Desktop slots: search, scope, filters, sort, result summary, reset.
- Phone: persistent search only when it is the primary task; other filters use `MobileFilterSheet`.
- Applied-filter summary and clear action remain visible after the sheet closes.

Reuse Operations’ responsive interaction model. Keep Inventory and Invoice domain filters as their own data owners.

### `LIVE-P0-04` — Object pages repeat primary information

**Rendered evidence**

- Workorder detail shows the concern as the page `h1`, the Concern section description, and the Requested work value—three visible repetitions.
- Create workorder shows “Create workorder” in the top task bar and again as the page `h1`.
- Samsara detail shows the provider name and description in the page header, then repeats both inside the provider card.
- Location Work correctly establishes the selected location in the page header, but its fixed-scope table still repeats “Chino Yard” in every row.

**Required shared change**

Add an `ObjectPageHeader` and `ObjectSummary` contract:

- Identity/title appears once.
- Status and primary actions sit with identity.
- Summary contains non-duplicated operational facts.
- The active section adds detail, not another copy of the title value.

For fixed-location Operations, hide the repeated Location column and keep the scope in the object header.

### `LIVE-P1-05` — Resource collections are too tall or too action-heavy

**Rendered evidence**

- Location Users has 70 users. A phone row measured about `156px`; the first page creates roughly `3,600px` of panel content.
- Each desktop User row exposes up to six small icon actions.
- Modules phone cards repeat description, page badges, four role permissions, and a full-width Manage action for every module.
- Settings phone provider cards measured about `275–292px` each.

**Required shared change**

Create two narrow shared patterns:

1. `RowActionsMenu`: one frequent action may remain visible; all other actions use the same accessible menu on desktop and phone.
2. `CompactResourceList`: identity, state, one key fact, and navigation/action. Expanded facts belong in detail.

Target phone User rows around `88–104px` while retaining `44px` actions. Add User search/filter because pagination alone is inefficient for 70 records. Convert Settings providers to compact navigable rows on phone. Module cards should summarize effective access, with the full role matrix in the manager.

### `LIVE-P1-06` — Settings and detail pages use redundant chrome

**Rendered evidence**

- Settings has only one “Integrations” tab, followed immediately by another “Integrations” heading.
- Samsara detail retains that single tab and then repeats the provider identity inside a bordered card.
- Rules spans the full operational width, placing its checkbox far from its label.
- Kiosk registration and device rows also stretch across the full page.
- Module manager remains nested below the Modules page header and scope control, creating three stacked context levels on phone.

**Required shared change**

Add a focused `SettingsPage`/`SettingsSection` composition:

- No tab bar when only one destination exists.
- Form/settings content maximum width around `960–1120px` unless a true matrix requires more.
- Shared `SettingsRow` aligns label, explanation, state, and control within a readable distance.
- Provider/module detail may replace the index body while preserving breadcrumb context; it should not repeat the parent title and card identity.

### `LIVE-P1-07` — Template Preview disappears on phone

**Rendered evidence**

- Desktop Template uses a `440px` form beside an approximately `1084px` Preview region.
- Phone hides the Preview entirely and exposes no visible Preview action.

**Required shared change**

Keep the desktop split, but rebalance it based on readable form width and useful document zoom. On phone, add a visible Preview action that opens the existing fullscreen/compact Preview surface. Do not attempt to place the printable page beside the form.

### `LIVE-P1-08` — Typography is restrained but some operational details are too quiet

**Rendered evidence**

- Secondary labels in tables, cards, and bottom navigation are visually very small.
- Dense desktop Operations is readable, but nine columns plus two-line date values create weak scan priority.
- Mobile bottom navigation meets target height, but six equal destinations give primary and secondary items the same visual importance.

**Required shared change**

Apply the shared `12/16`, `13/18`, and `14/20` typography roles consistently. Increase contrast/size for operationally meaningful secondary text before increasing general whitespace. The role pass confirms that phone destination reduction should preserve Needs action/In progress/Done for Office and Needs Odoo/Entered/Missing info for Surveillance, while secondary destinations remain available through the shared filter surface. Do not solve density by removing authorized destinations.

## 4. Page-by-page rendered findings

| Page | What works now | Visible issue | Plan change |
| --- | --- | --- | --- |
| Admin Operations | Strong desktop data density; phone decision tabs/cards and filter disclosure are effective | Desktop has nine columns and weak priority among repeated age/time fields | Use as responsive toolbar/card baseline; simplify column priority, not the workflow |
| Admin Inventory | Clear stock states, useful result counts, good part rows | Wrong heading level in Admin, separate white page shell, `150px` phone header, too many controls before results | First page migration after shared primitives |
| Inventory part detail | Clear identity, local/Odoo distinction, location drill-down, stable drawer | Header close/action density and stacked metric height need refinement | Preserve `SecondaryDetailPanel` as canonical; polish rather than replace |
| Inventory files | Breadcrumb and empty-state next action are clear | Inherits Inventory heading/shell problem | Migrate with Inventory presentation variants |
| Invoice intake | Strong status/amount cards and a good phone upload sheet | “Invoice” opens upload immediately; action label does not communicate that | Rename immediate action or separate History from Add invoice |
| Locations | Clean index and effective phone cards | Template “Missing” lacks a next action from the index | Preserve as page-shell baseline; consider direct readiness action later |
| Location Work | Shared Operations behavior remains consistent | Fixed location repeats the Location column in every row | Add fixed-scope column configuration |
| Location Users | Grouping and phone action menu are understandable | Six desktop icons, no search for 70 users, `156px` phone rows | Add `RowActionsMenu`, search, and compact rows |
| Location Template | Desktop form/Preview split communicates cause and effect | Preview region dominates desktop; phone has no Preview access | Rebalance desktop and add phone Preview action |
| Location Rules | Explanation and one primary Save action are clear | Full-width row separates label from control and wastes space | Adopt focused settings width and `SettingsRow` |
| Location Kiosk | Device state and dates are understandable | Full-width registration/device presentation lacks settings rhythm | Adopt focused settings width and compact device rows |
| Modules index | Scope-first empty state is correct; content is truthful | Phone cards are long and repeat the full permission summary | Compact index; keep full matrix in manager |
| Module manager | Breadcrumb, role access, and source labels are strong | Parent header, scope, nested object header, tabs, and cards stack heavily on phone | Use focused object-detail mode after scope selection |
| Settings index | Provider purpose/state/fact are clear | Single tab plus duplicate heading; `275–292px` phone cards | Remove single tab; compact phone provider list |
| Samsara detail | Authentication and sync facts are explicit | Provider title/description appear twice; parent single tab remains | Use one provider header plus unboxed settings sections |
| Create workorder | Desktop Preview and phone action dock work; phone form is calm | Title duplicated; desktop top controls feel fragmented | Add shared `TaskHeader`; retain section/dock behavior |
| Workorder detail | Shared object layout, Preview pane, summary, and phone section dock are strong | Concern appears three times; summary/detail priority is weak | De-duplicate through `ObjectPageHeader` and section contracts |
| Password-reset error | Centered access panel, clear recovery, `44px` action | Only invalid state was available | Preserve visual family; verify valid/error/loading states later |

## 5. Components to preserve

The live audit identified shared components that should be extended instead of replaced:

- `MobileFilterSheet` and Operations phone filter disclosure
- `ProgressiveQueue` and the full-width “Show more” action
- `SecondaryDetailPanel` for Inventory contextual detail
- `ContextBreadcrumbs` with focus-return behavior
- Location detail local tabs
- Workorder phone section dock
- Access panel proportions and subtle grid canvas
- Existing neutral canvas, semantic colors, and restrained elevation

## 6. Revised implementation priority

1. `OperatorPage`, upgraded `PageHeader`, and `PageHeaderActions`.
2. `CollectionToolbar` using Operations phone behavior.
3. Admin Inventory page/embedded variants.
4. `RowActionsMenu`, User search, and compact User rows.
5. `SettingsPage`, `SettingsRow`, and compact Settings provider/device lists.
6. Compact Modules index and focused module-manager detail.
7. `ObjectPageHeader`/`ObjectSummary` de-duplication for Workorder, Create, Integration, and fixed-location Work.
8. Template phone Preview access and desktop split refinement.
9. Office, Mechanic, and Surveillance collection enforcement, Surveillance phone-card repair, and remaining Kiosk/role-state audits.

Operations and Locations should receive only the shared-shell and column-priority changes required by these owners. They should not be rebuilt before the larger inconsistencies above.

## 7. Rendered acceptance additions

- Admin Inventory has one `h1`; Office-embedded Inventory begins at `h2`.
- Inventory phone header is no taller than the canonical stacked `PageHeader` pattern and exposes one primary action.
- Inventory phone reaches results without displaying every secondary filter inline.
- User phone rows fit identity, state, and menu within approximately `88–104px` under normal text sizing.
- Desktop User rows do not expose six equal icon actions.
- Settings phone provider rows expose identity, state, one fact, and navigation without `275px+` cards.
- Settings and provider detail do not render a one-item tab bar.
- Provider identity and description appear once on integration detail.
- Workorder concern is not repeated as title, description, and requested-work card simultaneously.
- Fixed-location Work does not repeat the same location in every row.
- Template exposes Preview on phone.
- The good current patterns listed in Section 5 remain intact.

## 8. August 29 role-by-role audit corrections

### Evidence and safe account boundary

The canonical QA-account tool created `uxaudit.admin`, `uxaudit.office`, `uxaudit.mechanic`, and `uxaudit.surveillance` only after confirming `DATABASE_URL` resolved to loopback `localhost:5433`. All four accounts used the existing company and Chino Yard memberships. The audit performed navigation, responsive resizing, dialog opening, and read-only detail inspection. It did not accept work, create or close workorders, approve invoices, save settings, run provider actions, send email, post inventory, or mutate Odoo.

### `LIVE-P0-09` — Desktop role queues ignore the universal 20-record contract

**Verified rendered evidence**

- Office Needs action mounted `197` workorder articles and `30` mechanic-rail buttons in one desktop document: approximately `14,651px` page height and `241` controls.
- Surveillance mounted `81` Active, `57` Awaiting office, `33` Needs Odoo, and `29` Entered articles in their desktop queues.
- Mechanic Available jobs mounted all `30` records on desktop.
- Phone Mechanic and Surveillance correctly limited initial rendering to `20`, proving the progressive renderer already exists but is not the cross-viewport collection owner.
- Modules showed `14 modules · company default` but split them into two pages instead of showing all `14` within the universal default capacity of `20`.

**Operator impact**

Long desktop documents increase scan time, browser work, refresh churn, and focus-restoration risk. Different record counts between desktop and phone make page position and result expectations unpredictable.

**Required behavior**

Server-backed Office, Mechanic, and Surveillance queues request/render `20` records per page at every viewport. The Office mechanic rail shows `20` people with search and an explicit next page or `20`-item continuation. A bounded Modules collection with only `14` records renders one page and omits pagination.

### `LIVE-P0-10` — Invoice review is still a long page beside and below its evidence

**Verified rendered evidence**

- The selected realistic invoice reported `3 values need attention`, but the first review viewport began with the document and confident fields rather than an actionable exception list.
- Desktop document height was approximately `2,060px`; Invoice lines began around `880px`, below the first viewport. The form continued below the source viewer instead of remaining inside a bounded split workspace.
- Phone document height was approximately `4,055px`; Invoice lines began around `1,989px`. The source image and viewer tools consumed most of the first task viewport before the first editable field.
- Every confident field displayed equal visual structure and extraction evidence, making three exceptions compete with many already-confident values.

**Required behavior**

Use a viewport-bounded source canvas plus guided review rail on wide desktop, beginning evaluation near `52/48` or `55/45` source/review. Open `Needs attention` first, collapse completed sections to useful summaries, render line items as compact rows with one-row editing, keep totals/checks together, and keep draft state plus approval visible without covering focused controls. Phone switches between explicit Document and Review modes and opens on the first unresolved field when attention exists.

### `LIVE-P0-11` — Odoo configuration exposes an unbounded control surface

**Verified rendered evidence**

Odoo detail reported `0 of 249` locations mapped and produced `529` visible controls in the composed page. This is a data-management workspace presented as one settings page, not a bounded review queue.

**Required behavior**

Separate connection health, outbound readiness, vehicle mapping, warehouse/location mapping, labor setup, and inventory mapping into explicit peer sections. Each repeated mapping collection uses search, status filters, and `20` records per page. The detail header shows provider identity once; consequential sync/test actions remain near the state they affect.

### `LIVE-P1-12` — Shared details repeat identity and work context

**Verified rendered evidence**

- Create workorder renders `Create workorder` as both task chrome and the page `h1`.
- Office detail repeats the same concern as `h1`, section summary, and editable Mechanic concern.
- Surveillance detail repeats workorder identity and the requested-work sentence several times.
- Integration detail repeats provider identity as both `h1` and provider-card `h2`.
- Module detail retains the parent Modules header and scope control, then repeats module identity in a nested detail region.

**Required behavior**

`TaskHeader` owns creation identity once. `ObjectPageHeader` owns object identity/status once. Sections add information and edit affordances rather than repeating header facts. Provider and module details use focused object mode with one title and one path back.

### `LIVE-P1-13` — Surveillance phone cards have a text-collision failure

**Verified rendered evidence**

At the phone-class viewport, long QA workorder identifiers and problem text visibly overlapped adjacent metadata in Needs Odoo cards. The DOM had no horizontal overflow, so overflow metrics alone would have missed the illegible composition.

**Required behavior**

Phone cards use separate block rows for identity, problem, combined location/mechanic metadata, update time, and state. Long unbroken identifiers wrap or truncate with an accessible full value; no text layers occupy the same vertical line box.

### Preserved strengths from the role pass

- Sign in and forgot-password remain compact, readable, and correctly modal on phone.
- Role homes clearly state the operator's role and primary queue.
- Mechanic and Surveillance phone queues already use a `20`-record progressive boundary.
- Create and detail phone section docks keep the active work area reachable.
- Workorder details maintain one shared responsive family across Office, Mechanic, and Surveillance; the correction is de-duplication and state clarity, not separate role designs.

### Page-family coverage ledger

`Verified` means the normal rendered surface was inspected in the current local application. `Partial` means only some states or roles were safely available. `Unverified` is not acceptance.

| Page family | Coverage | Remaining evidence |
| --- | --- | --- |
| Standard sign in | Verified | Error, rate-limit, and unavailable-account states |
| Forgot-password dialog | Verified | Submission/delivery intentionally not run |
| Invitation acceptance and account-ready | Unverified | Valid local invitation token |
| Password reset | Partial | Invalid state from first pass; valid token and completion remain |
| Account unavailable and route loading | Partial | Real unavailable account and slow/failure transitions |
| Kiosk mechanic roster | Unverified | Safe registered local Kiosk session |
| Kiosk unlock and PIN change | Unverified | Kiosk session plus test mechanic PIN state |
| Mechanic queue | Partial | My work/Available normal states verified; Waiting, History, errors, and long assigned work remain |
| Office workorders hub | Partial | Normal queue and embedded Inventory verified; Parts and Drafts need representative records |
| Admin Operations | Verified | Exact viewport/zoom and error/offline acceptance remain |
| Admin Inventory | Verified | Exact viewport/zoom and mutation refresh remain |
| Admin Locations | Verified | Empty/loading/failure states remain |
| Location Work, Users, Template, Rules, Kiosk settings | Verified | Save/destructive actions intentionally not run |
| Admin Modules index and manager | Verified | Save/permission mutation intentionally not run |
| Settings and Samsara/Odoo/machine-client detail | Verified | Provider actions intentionally not run |
| Invoice intake list/upload/review | Verified | Approval, receipt, failure, maximum-length, and save/resume remain |
| Inventory files/count import | Partial | Entry/detail from first pass; apply intentionally not run |
| Surveillance queues and detail | Verified | Error/offline and mutation actions remain |
| Create workorder | Verified | Submission intentionally not run |
| Shared workorder detail | Verified across Office, Mechanic, and Surveillance | Accepted/completion/save/recovery states remain |
| Inventory scan and exact-unit result | Unverified | Safe exact-unit fixture and scanner state |

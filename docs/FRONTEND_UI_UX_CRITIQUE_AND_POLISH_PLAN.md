# Frontend UI/UX Critique and Precision Polish Plan

- **Status:** Critical design review and planning contract; implementation not started
- **Date:** August 29, 2026
- **Product:** Owl workorder and inventory operations software
- **Platform interpretation:** Responsive industrial web application used through desktop pointer/keyboard and phone touch interfaces
- **Companion roadmap:** [Frontend Experience Vision and Page Delivery Roadmap](./FRONTEND_PAGE_VISION_AND_ROADMAP.md)
- **Visual contract:** [Operator Page Design System](./OPERATOR_PAGE_DESIGN_SYSTEM.md)
- **Collection contract:** [Frontend Collection, Data Density, and Refresh Contract](./FRONTEND_COLLECTION_REFRESH_CONTRACT.md)
- **Rendered baseline:** [Frontend Live UI Audit](./FRONTEND_LIVE_UI_AUDIT.md)

## 1. Critical verdict

Owl has the right visual temperament: quiet canvas, restrained color, clear data, limited decoration, and increasingly strong phone behavior. It does not yet feel like one premium system because small geometry decisions are not governed tightly enough.

The main premium-quality gap is drift:

- page gutters render at different values;
- radius values proliferate across features;
- operational labels fall to `10–11px`;
- some pages use borders, some cards, some shadows, and some full white page containers for equivalent hierarchy;
- desktop tables show more facts than the eye can rank;
- phone pages sometimes spend more space on controls and repeated explanation than on work;
- headings and page identity are duplicated or semantically inconsistent.

Do not add glass, gradients, larger shadows, or more animation to solve this. Apple’s useful principles here are clarity, deference, predictable touch behavior, and disciplined depth. Liquid Glass is not appropriate for a data-heavy industrial web product and would reduce contrast and increase visual noise.

## 2. Adapted HIG and product-quality scorecard

This score adapts the Apple HIG audit template to a responsive web operations product. Native-only items such as Dynamic Island and haptics are not scored as requirements.

| Area | Score | Critic assessment |
| --- | ---: | --- |
| Visual design and aesthetic | `12 / 20` | Strong restraint and semantic palette; weak token adoption, tiny labels, radius entropy, and inconsistent surface ownership |
| Navigation and layout | `14 / 20` | Clear role navigation, strong phone queue disclosure, no measured horizontal overflow; repeated context and uneven page geometry remain |
| Accessibility | `18 / 30` | Sampled phone targets pass `44px`; most tested color pairs pass; exact text reflow, low-contrast meaningful text, heading hierarchy, and full keyboard behavior remain incomplete |
| Interaction, feedback, and motion | `14 / 20` | Conservative motion and good drawer/filter foundations; refresh, stale state, focus preservation, and reduced-motion ownership are not yet universal |
| Cross-platform adaptation | `6 / 10` | Desktop and phone compositions are real and distinct; tablet, exact breakpoints, text zoom, desktop shortcuts, and role-specific live sessions remain incomplete |
| **Total** | **`64 / 100`** | **Solid operational foundation; not premium-consistent yet** |

The score is not a compliance certificate. It is a prioritization tool based on current rendered and source evidence.

## 3. Evidence and confidence

### 3.1 Live rendered evidence

Verified through the local Admin Demo session:

- Locations and Location Users;
- Operations;
- Inventory;
- Modules empty/scope state;
- Settings integrations index;
- previously audited location detail tabs, Template, Rules, Kiosk, integration detail, Create, workorder detail, nested Inventory workflows, and access error state.

The browser requested `1440 × 900`, `768 × 1024`, `390 × 844`, and `320 × 844`. Host scaling reported effective CSS widths of approximately `1600`, `853`, `433`, and `355`. These prove desktop-, tablet-, phone-, and narrow-phone-class behavior, not exact breakpoint acceptance.

### 3.2 Measured visual evidence

| Evidence | Measurement | Critic conclusion |
| --- | --- | --- |
| Desktop Locations/Operations title start | `28px` from left | Misses planned `32px` desktop gutter |
| Phone Operations/Inventory/Settings title start | `14px` from left | Misses planned `16px` phone gutter |
| Desktop Admin navigation buttons | `38px` high | Below product’s planned `40px` pointer control |
| Sampled phone controls | `44px` or taller; bottom navigation about `53px` | Touch-target foundation is strong |
| Operations desktop | Nine columns; dominant `13px`, `12px`, and `11px` text | Dense but visually flat; priority is encoded through size too weakly |
| Operations phone | Twenty cards; each uses `10px` radius and subtle shadow; repeated `11px` Odoo state | Readable structure, but repeated shadow/radius and tiny state text create a miniature-card aesthetic |
| Inventory desktop | Top-level title is `h2`; page surface radius `14px`; controls use `9px`; statuses use `10px` | Visibly separate design language and incorrect page semantics |
| Inventory phone | Heading plus three exposed actions and all filters before results | Too much command chrome before the operator reaches stock |
| Settings phone | Page title, single Integrations tab, second Integrations title; provider cards around `275–292px` | Repeated hierarchy and oversized summaries make configuration feel like a marketing card list |
| Location Users phone | First user row `156px`; first 15-user group about `2548px`; first-page panel about `3452px` | Excess scrolling and weak comparison speed |
| Location Users tablet-class | `109` visible `44px` controls on first page | Desktop action model leaks into middle widths and overwhelms content |
| CSS radius inventory | At least `15` distinct radius values/shapes; `6px` and `8px` are common, but `5/7/9/10/14/16/18/24px` also recur | Approved radius ladder is not controlling implementation |

### 3.3 Accessibility tooling caveat

The static scanner reported `848` raw flags across `227` files. The count is not trustworthy as a compliance result:

- it treated CSS files and nested components as complete pages and reported missing landmarks;
- it treated valid nested `<label><input /></label>` and React Aria `TextField`/`Label` compositions as unlabeled;
- it treated the live muted camera preview as prerecorded media requiring captions;
- it treated a non-interactive click-propagation wrapper as an inaccessible click target.

Verified signals from the tools and live UI:

- sampled `44 × 44` and `69 × 53` phone targets pass the HIG checker;
- `122 × 38` desktop Admin navigation misses the Apple `44px` touch rule and the product’s narrower `40px` desktop rule;
- `#667085` on white passes AA at `4.97:1`;
- `#98a2b3` on white fails at `2.58:1` and must be limited to truly disabled/non-essential decoration;
- tested blue, success, warning, and error text/background pairs pass AA normal-text contrast;
- Inventory’s missing top-level `h1` and Settings’ repeated heading hierarchy are rendered, verified issues.

All automated findings require component-aware and rendered verification before becoming defects.

## 4. Precision visual system

### 4.1 Spacing rhythm

Use a `4px` base for optical adjustments and an `8px` rhythm for composition.

Approved spacing:

| Value | Role |
| ---: | --- |
| `4px` | Badge padding, icon optical correction, very tight metadata gap |
| `8px` | Icon/text gap, adjacent control gap, compact metadata stack |
| `12px` | Dense cell padding and compact card internal gap |
| `16px` | Standard card padding and phone gutter |
| `20px` | Dense section separation only |
| `24px` | Standard section separation and tablet gutter |
| `32px` | Desktop gutter and major composition separation |
| `40/48/64px` | Empty states and intentionally large task separation |

Rules:

- Major page positions use multiples of `8px`.
- `4px`, `12px`, and `20px` are allowed inside dense components.
- Unexplained `5px`, `7px`, `9px`, `10px`, `14px`, and `18px` layout gaps do not survive migration.
- Do not create double gutters. Embedded workflows inherit their host.
- Vertical gaps increase with hierarchy: metadata `4–8`, fields `12–16`, sections `24`, major page zones `32`.

### 4.2 Page proportions

| Viewport class | Outer gutter | Header-to-content gap | Page-title size |
| --- | ---: | ---: | ---: |
| Phone `≤640px` | `16px` | `24px` | `22/28px` |
| Tablet `641–1024px` | `24px` | `24px` | `24/30px` |
| Desktop `≥1025px` | `32px` | `24–32px` | `24/30px` |

Width rules:

- dense operational collection: use available width up to `1920px`;
- settings and standard forms: `960px` preferred, `1120px` hard maximum unless a real matrix requires more;
- long explanatory copy: `640–720px`;
- modal form: generally `480–640px`;
- detail drawer: `420–560px`, with phone fullscreen/bottom-sheet behavior.

Page title and description should occupy no more than one-third of a desktop header when actions need space. Description stays one concise line when possible and does not repeat scope already visible in breadcrumbs or tabs.

### 4.3 Radius system

Approved radius ladder:

| Token | Value | Use |
| --- | ---: | --- |
| `--radius-badge` | `4px` | Compact status tags, flags, small counters with text |
| `--radius-control` | `6px` | Buttons, inputs, selects, tabs, icon controls |
| `--radius-surface` | `8px` | Tables, cards, inline panels, grouped settings |
| `--radius-overlay` | `12px` | Dialogs, popovers, drawers; phone bottom sheet uses top corners only |
| `--radius-pill` | `999px` | Avatars, true pills, binary segmented indicators only |

Rules:

- Remove `5/7/9/10/14/16/18/24px` radius values from migrated product surfaces.
- A child surface cannot be rounder than its containing surface unless it is a true pill or circle.
- Nested surfaces reduce radius by roughly the container padding: outer `12`, inner `8`; outer `8`, inner `4–6`.
- Radius never communicates importance. Color, position, label, and size own importance.
- Printable document geometry and true circular controls remain documented exceptions.

### 4.4 Borders and elevation

Depth communicates overlap, not decoration.

- Inline/table/card surfaces: one `1px` neutral border, no shadow.
- Selected row: border/focus ring or subtle background, not a larger shadow.
- Menus/popovers: shared small overlay shadow.
- Drawers/dialogs: shared large overlay shadow plus backdrop.
- Sticky headers/footers: separator border; shadow only when scrolling content visibly passes beneath.
- Do not combine border, tinted fill, and shadow on every phone card.
- Operations phone cards should keep either the subtle border or shadow. Preferred: border only, with attention encoded by leading accent and state label.

### 4.5 Typography

| Role | Size/line height | Weight |
| --- | --- | ---: |
| Page title desktop | `24/30px` | `650–700` |
| Page title phone | `22/28px` | `650–700` |
| Section title | `18/26px` | `600` |
| Card/row identity | `14/20px` | `600` |
| Body/control text | `14/20px` | `400–600` |
| Secondary metadata | `13/18px` | `400–500` |
| Caption/label/status | `12/16px` | `500–650` |

Rules:

- `12px` is the minimum for meaningful operational text.
- `10–11px` may appear only in non-interactive print-preview scale representations, never as the sole onscreen status, identifier, date, count, or navigation label.
- Use size before color to establish hierarchy; low contrast does not substitute for secondary hierarchy.
- Use tabular numerals for quantities, counts, money, elapsed time, and aligned dates.
- Headings use sentence case and sequential levels.
- Table headers may be `12px`; data remains `13–14px`.
- Clamp long table text to two lines; detail owns the full value.

### 4.6 Color and contrast

- Neutral canvas: existing `#eef2f6` direction is appropriate.
- Primary text: `#181d27`/`#182230` family.
- Secondary meaningful text: `#535862` or `#667085` on white.
- `#98a2b3` is restricted to disabled text, decorative icons, and unavailable placeholders whose meaning is also conveyed another way.
- Blue denotes action, selection, focus, and links—not general decoration.
- State colors always include text or icon labels.
- Semantic tinted backgrounds remain subtle; repeated whole-row tinting should be limited to actual lifecycle scanning needs.
- Focus rings must maintain at least `3:1` against adjacent colors and remain visible in high-contrast modes.
- Future token work must include forced-colors and high-contrast verification; dark mode is not required for this plan unless separately prioritized.

### 4.7 Controls and iconography

- Desktop pointer control: `40px` minimum height.
- Phone/high-frequency touch control: `44px` minimum height and width.
- Icon button: square; icon centered; visible label or tooltip where meaning is not universal.
- Inline icon: `16px`; standard control icon: `18px`; navigation/primary icon: `20px`; empty-state illustration icon: `24–32px`.
- One icon library and consistent stroke weight per surface.
- Button hierarchy per region: one primary, optional secondary, then text/menu actions.
- Destructive action never shares primary blue styling.
- Full-width phone buttons are reserved for task continuation, not every row’s “Manage” action.

### 4.8 Motion and feedback

- Hover/focus/color response: `120–180ms`.
- Control and small-surface transition: `180–200ms`.
- Overlay enter/exit: `200–240ms`.
- `320ms` is the upper bound for large surface movement.
- No animation delays access to data or action.
- One global reduced-motion contract must cover every animation and transition owner.
- Loading skeletons pulse only when motion is allowed.
- Background refresh does not flash, remount, or shift content.
- Press/busy response appears within `100ms`.

## 5. Information and interaction ratios

### 5.1 Collection density

Every collection shows `20` records by default. Additional records use pagination or increments of `20`.

Desktop row budget:

- one identity;
- one status/lifecycle;
- three to five decision facts;
- no more than two timestamp columns;
- one action/menu column.

Phone card budget:

- one identity block;
- one status;
- up to four facts;
- one decision sentence only when necessary;
- one primary action or actions menu.

### 5.2 Hierarchy ratio

Each page should make its hierarchy visible at a glance:

1. page/object identity;
2. current state or queue;
3. primary next action;
4. filters and summary;
5. records/detail;
6. secondary explanation.

If explanation, filter chrome, or repeated scope occupies more vertical space than the first actionable records, the page fails review.

### 5.3 Action ratio

- Page header: one primary action.
- Toolbar: no more than four visible controls before overflow/disclosure on desktop; phone retains search plus one filter trigger when search is primary.
- Resource row: one frequent action or one menu.
- Confirmation surface: one confirm and one cancel; destructive confirm is explicit.
- Settings index: row navigation replaces repeated full-width Manage buttons on phone.

## 6. Page-by-page critic findings

### Admin Operations

**Keep:** full-width operational surface, decision queues, phone filter disclosure, `20`-record phone presentation, clear Create action.

**Critique:** nine desktop columns flatten priority; three age/time concepts compete; `11px` status text is too small; repeated card shadows add texture without meaning; fixed Location repeats inside location-scoped Work.

**Plan:** six primary desktop columns by default; move secondary timestamps to drawer/detail; minimum `12px` status; border-only phone cards; remove fixed scope from rows.

### Inventory

**Keep:** stock math, clear availability states, compact result rows, contextual detail drawer.

**Critique:** wrong top-level heading, `14px` page radius, `9px` controls, `10px` statuses, stacked phone actions, and fully exposed filters create a separate visual system.

**Plan:** canonical page/embedded variants; `4/6/8/12` radii; one phone primary action plus overflow; search plus filter sheet; status minimum `12px`; projection freshness near results, not header decoration.

### Locations and Location Work

**Keep:** clean cards, object breadcrumbs, local tabs, useful readiness facts.

**Critique:** Missing template is a dead-end label from the index; location-scoped Work repeats location; desktop/mobile gutters miss planned tokens.

**Plan:** add truthful readiness next action where authorized; remove repeated scope; migrate geometry without redesigning the working card model.

### Location Users

**Keep:** grouping and phone actions menu.

**Critique:** `156px` phone rows and roughly `3452px` first-page panel make comparison slow; tablet exposes more than one hundred action controls; placeholder “—” values add noise.

**Plan:** `88–104px` phone rows, one actions menu at every width, User search, hide non-applicable facts rather than rendering “—”, maintain `20` records per page.

### Template, Rules, and Kiosk

**Keep:** localized tabs and focused task ownership.

**Critique:** Template Preview disappears on phone; Rules and Kiosk stretch settings across operational width; form/control distances weaken association.

**Plan:** phone Preview action; focused `960px` settings width; shared SettingsRow; nearby label/control; compact device resources.

### Modules

**Keep:** scope-first empty state, truthful role/source model.

**Critique:** selected-scope cards repeat description, badges, permissions, and Manage; manager stacks parent and object context.

**Plan:** compact index row with identity, effective-access summary, one state, chevron; manager replaces index body after scope selection while preserving breadcrumb.

### Settings and integrations

**Keep:** truthful provider state, explicit facts, restrained color.

**Critique:** one-item tab, repeated Integrations title, article headings at the same level as section title, `275–292px` phone cards, repeated full-width Manage buttons.

**Plan:** remove single tab; use one section heading and `h3` provider identities; compact provider rows; provider detail uses one identity header and unboxed settings sections.

### Create and workorder detail

**Keep:** desktop supporting Preview, phone section/action docks, role-aware sections.

**Critique:** Create title repeats; workorder concern appears three times; supporting facts compete with identity; `3s` refresh requires overlap/edit safety proof.

**Plan:** TaskHeader/ObjectPageHeader; identity once; summary contains only non-repeated facts; sections add information; near-real-time refresh pauses for unsafe edits and retains focus/context.

### Access and Kiosk

**Keep:** calm access panel, clear invalid-reset recovery, touch-first Kiosk direction.

**Critique:** full valid flows and Kiosk session remain unverified; static scan produced possible heading concerns that require rendered state-by-state verification.

**Plan:** audit valid/loading/error/recovery at text zoom, keyboard, screen reader, and onscreen-keyboard conditions before changing the established visual family.

## 7. Stress test of the current plan

### Risk 1 — Tokens exist in documentation but not implementation

The plan defines `4/6/8/12/999`, but source still contains many local values. Page migrations would reproduce drift without enforcement.

**Correction:** Wave 0 must add real CSS tokens, a migration inventory, and a review check rejecting undocumented radius/spacing values in migrated owners.

### Risk 2 — “Make every page consistent” could flatten useful differences

Operations, settings, detail, and scan have different jobs.

**Correction:** standardize geometry, type, controls, states, and depth; preserve domain information architecture and density.

### Risk 3 — Exact numerical polish could become mechanical

A strict grid can clip translations, text zoom, or operational identifiers.

**Correction:** values define minimums and rhythm. Content reflows; essential text never clips to maintain a target height.

### Risk 4 — Universal `20` records could still create long phone pages

Twenty `156px` User rows remain unusable even with consistent pagination.

**Correction:** keep `20`, but enforce information and row-height budgets before declaring collection consistency.

### Risk 5 — Radius cleanup alone could consume effort without improving work

Changing `10px` to `8px` does not fix repeated headings or six actions.

**Correction:** hierarchy and interaction reduction precede cosmetic token cleanup within each page migration; both ship in one reviewed page unit.

### Risk 6 — Automated accessibility counts could drive incorrect fixes

The scanner cannot understand every component composition.

**Correction:** use raw scan as triage only. Verify accessible name, role, keyboard behavior, focus, contrast, and rendered state before planning a defect.

### Risk 7 — Apple-inspired styling could undermine industrial clarity

Translucency and decorative depth could reduce contrast around dense data.

**Correction:** retain Apple’s clarity/deference principles; reject decorative glass. Use opaque surfaces, semantic color, and depth only for actual overlays.

### Risk 8 — Desktop can become too sparse after simplification

Removing columns without adding useful structure could waste wide displays.

**Correction:** use width for the most important columns, readable line lengths, summary context, and contextual detail—not for repeated timestamps or decorative empty panels.

## 8. Revised delivery gates

### Gate A — Foundation

- CSS tokens exist for approved spacing, radius, color, type, control heights, borders, shadows, and motion.
- Migrated components contain no undocumented radius values.
- Meaningful onscreen text is at least `12px`.
- Phone and desktop gutters render at `16/24/32px` by viewport class.

### Gate B — Component specimens

Render PageHeader, controls, tabs, badges, cards, table rows, SettingsRow, menus, overlays, pagination, and refresh states together. Confirm visual family before page migration.

### Gate C — One-page migration

For each page:

1. record three operator frictions;
2. reduce repeated information/actions;
3. apply geometry and visual tokens;
4. render initial/loading/updating/empty/error/populated states;
5. verify keyboard, focus, contrast, touch, text reflow, and reduced motion;
6. compare before/after screenshots at all target widths;
7. prove workflow/API/permission behavior unchanged.

### Gate D — Product-wide acceptance

- exact `390`, `768`, `1440`, and `1920px` rendering;
- `320px` reflow;
- `200%` browser text zoom and applicable `300%` large-text stress state;
- keyboard-only primary journeys;
- screen-reader spot checks for navigation, collection, dialog, and status updates;
- high-contrast/forced-colors spot checks;
- no horizontal page movement;
- no tiny operational text, repeated page identity, uncontrolled shadows, or undocumented radii.

## 9. Priority changes

1. Make visual tokens executable and enforceable before page migrations.
2. Fix page shell, gutters, header hierarchy, and responsive actions.
3. Fix minimum operational type size, control heights, icon scale, contrast usage, and depth.
4. Fix collection toolbar, `20`-record behavior, refresh state, and compact row/card budgets.
5. Migrate Inventory.
6. Migrate Location Users.
7. Migrate Settings/integrations.
8. Migrate Modules.
9. De-duplicate Create and workorder detail.
10. Restore Template Preview and focus Rules/Kiosk composition.
11. Apply minimal consistency polish to Operations and Locations without replacing their successful patterns.
12. Complete live role audits before Mechanic, Office, Surveillance, access, and Kiosk implementation units.

## 10. Review ledger addition

### August 29, 2026 — Precision UI/UX critic pass

- Adapted Apple HIG principles to industrial web rather than importing Liquid Glass.
- Scored current foundation `64/100`: operationally solid, visually inconsistent.
- Measured gutter, control, typography, radius, card, and row geometry across desktop/tablet/phone-class renders.
- Added strict `4/6/8/12/999` radius ladder and nested-radius rules.
- Added minimum `12px` meaningful text and exact typography hierarchy.
- Added border/elevation, spacing, icon, motion, contrast, and action-ratio contracts.
- Triaged accessibility tooling and rejected false-positive counts as compliance evidence.
- Promoted executable token enforcement and component specimens ahead of page migration.

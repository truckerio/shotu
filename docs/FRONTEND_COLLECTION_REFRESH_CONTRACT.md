# Frontend Collection, Data Density, and Refresh Contract

- **Status:** Planning contract; implementation not started
- **Date:** August 29, 2026
- **Purpose:** Define how much information each page shows, how collections paginate, and how loading, refresh, filtering, and mutations preserve operator context.
- **Companion roadmap:** [Frontend Experience Vision and Page Delivery Roadmap](./FRONTEND_PAGE_VISION_AND_ROADMAP.md)
- **Rendered baseline:** [Frontend Live UI Audit](./FRONTEND_LIVE_UI_AUDIT.md)
- **Authority boundary:** This contract changes presentation and client orchestration only. It does not change API permissions, Odoo authority, inventory identity, or workorder lifecycle rules.

## 1. Decision summary

Every list, table, queue, card collection, and bounded history uses `20` records as its default page size. Information density may vary by task, but record count remains predictable:

1. Live operational queues use server pages of `20` when server-paginated.
2. Search-heavy records such as Inventory, Users, and invoice history use pages of `20`; server pagination becomes mandatory when the source is no longer safely bounded.
3. Small administrative collections also use pages of `20`. Collections with fewer records simply omit pagination.
4. Phone collections show cards, not compressed desktop tables. Each card exposes one identity, one status, up to four key facts, and one primary action or actions menu.
5. Refresh keeps current content visible. Initial loading, background updating, stale data, offline data, and failure are distinct states.
6. Auto-refresh is reserved for time-sensitive operational data. Static settings do not poll.
7. Search, filter, sort, and scope changes reset to page 1. Refresh never resets page, filters, sort, selection, drawer, focus, or scroll unless the selected object no longer exists.

## 2. Collection information budgets

### 2.1 Desktop tables

| Collection type | Server/client page | Visible columns | Row height target | Examples |
| --- | ---: | ---: | ---: | --- |
| Live operations | `20` records | `6` primary; up to `9` at `1440px+` | `64–76px` | Operations, part requests |
| Search-heavy catalog/history | `20` server records | `5–7` | `56–72px` | Inventory, invoices, Users when server-backed |
| Small admin collection | `20` client records | `4–6` | `56–68px` | Locations, Modules, devices, integration clients |
| Dense audit/history | `20` server records | `4–6` | `56–72px` | Activity, service history, inventory events |

Desktop column rules:

- One identity column remains first and receives the largest width.
- One status/lifecycle column remains visible without horizontal scrolling.
- One action column remains last; it contains one frequent action or one actions menu.
- No more than two date/time columns appear simultaneously. Combine related values or move secondary timestamps into detail.
- A fixed page scope is not repeated in every row. Example: Location Work hides Location when the selected location already owns the page.
- IDs, status, and primary action do not rely on hover.
- Long concern/description text uses two lines maximum in a table. Full text belongs in drawer/detail.
- Desktop tables do not horizontally scroll at `1440px`. If the information budget cannot fit, remove or combine columns before adding horizontal scrolling.

### 2.2 Tablet collections

At `768px`, use a table only when four or fewer compact columns remain clear. Otherwise use structured rows/cards.

Each tablet row/card may show:

- identity;
- status;
- three or four operational facts;
- one primary action or actions menu.

Secondary filters may remain inline when they fit on one row. Overflow filters use the shared filter sheet. Do not create a two-line toolbar of unrelated controls.

### 2.3 Phone collections

Phone initial display is `20` records for operational queues and server-backed catalogs. Further local records appear through “Show 20 more”; further server records use Next after the current server page is exhausted.

Each phone card shows at most:

- one identity block, maximum two text lines;
- one status or urgency indicator;
- four key facts;
- one short supporting sentence when it changes the next decision;
- one primary row action or one `44px` actions menu.

Phone cards do not show:

- every desktop column;
- repeated page scope;
- more than two timestamps;
- more than one paragraph of description;
- a full role-permission matrix;
- several equal icon actions.

Phone collection targets:

| Surface | Initial records | Increment | Target card/row height |
| --- | ---: | ---: | ---: |
| Workorder/Operations queues | `20` | `20` | `88–132px`, based on action needs |
| Inventory/results | `20` server | Next server page | `72–96px` |
| Users | `20` | Next page | `88–104px` |
| Invoices | `20` server | Next server page | `96–128px` |
| Locations | `20` | Next page | `112–136px` |
| Modules | `20` | Next page | `88–120px` summary only |
| Devices/clients/invitations | `20` | Next page | `80–112px` |

These are density targets, not clipping requirements. Text zoom and translated content may increase height. Content must reflow rather than truncate essential identity or status.

## 3. Pagination contract

### 3.1 Server pagination

Use server pagination when a collection can grow beyond `100` records, filtering/sorting belongs to the API, or loading the complete dataset would distort freshness or performance.

Server response must provide:

- current page;
- page size;
- total matching records;
- page count or a truthful next-page indicator;
- stable item IDs;
- applied sort when the server can normalize it.

Client behavior:

- Search, filter, sort, scope, and queue changes reset to page 1.
- A refresh retains the current page.
- If deletion/filtering makes the current page invalid, clamp to the last valid page and announce the change.
- Next/Previous controls disable while their requested page is loading.
- Page changes move focus to the collection heading or first result and scroll the collection start into view; they do not jump the whole application unexpectedly.
- Drawer/detail close restores focus to the originating row when it remains present.
- Browser Back restores page, search, filters, sort, selected queue, and scroll when route ownership supports it.

### 3.2 Client pagination

Client pagination is allowed only for already-loaded, bounded administrative collections. Default size remains `20` for every collection:

- Locations: `20`;
- Modules: `20`;
- Users: `20` until server pagination is justified;
- invitations, devices, and integration clients: `20`.

Filtering happens before pagination. Filter/query changes reset page 1. Collection mutation clamps an invalid page without losing the active query.

### 3.3 Progressive phone disclosure

`ProgressiveQueue` remains the shared owner for phone-only “Show more” behavior:

- active at `700px` and below;
- first `20`, then increments of `20`;
- button states the next count and remaining count;
- resets when queue, scope, search, filter, sort, or server page changes;
- desktop/tablet output remains complete for the supplied server page;
- does not replace server pagination.

For a server-paginated Operations page, the server supplies `20`, so the operator uses Next for the following page. For an already-loaded bounded role queue, progressive disclosure produces `20 → 40 → 60`. Do not silently fetch an unbounded queue when “Show more” is pressed.

## 4. Search, filter, and sort contract

- Search debounce: `200–300ms` for server-backed text queries.
- Abort or ignore every stale request when query state changes.
- Search input remains editable while results update.
- One result summary states total and active scope.
- Phone shows persistent search only when search is the primary collection task. Secondary filters belong in `MobileFilterSheet`.
- Applied phone filters remain summarized after the sheet closes, with one Clear action.
- Clear resets narrowing filters but preserves fixed route scope.
- Sort has a truthful default and explicit direction. Stable identity breaks ties.
- Empty state distinguishes “no records exist” from “filters hide records.” Filtered-empty state offers Clear filters.
- Search/filter state survives detail open/close. Durable preference storage is limited to useful operator defaults, not transient search text unless explicitly required.

## 5. Refresh and freshness contract

### 5.1 State model

Every data owner uses these distinct states:

| State | Existing content | UI treatment | Actions |
| --- | --- | --- | --- |
| Initial loading | None | Geometry-matched skeleton or concise loading state | Disable dependent actions |
| Background updating | Keep visible | Subtle “Updating” state and `aria-busy`; no blank collection | Keep safe read/navigation actions available |
| Fresh | Visible | No persistent success noise | Manual refresh available where useful |
| Stale but usable | Keep last successful data | Non-blocking warning with last successful time | Retry/Refresh |
| Offline cached | Keep last successful data | Offline notice; identify blocked writes | Retry automatically on reconnect |
| Blocking error without data | None | Error state with specific retry | Retry |

Background refresh must never replace populated tables/cards with skeleton rows or empty state. Refresh failures retain the last successful content and add a warning.

### 5.2 Automatic refresh policy

| Data type | Default behavior | Reason |
| --- | --- | --- |
| Role dashboards and Operations queues | `30s`, plus focus/visibility/network recovery | Assignment and status change during active work |
| Open workorder detail | Near-real-time owner, currently `3s`; pause when editing/unsafe | Chat, assignment, and lifecycle can change while open |
| Draft lists | `30s` where Office/Admin manage shared drafts | Ownership can change |
| Vehicle lookup/detail support | `60s` only while selected/enabled | Useful but less urgent |
| Inventory stock | Manual refresh and refresh after inventory mutation | Avoid implying Odoo projection is real-time |
| Invoice/count workflows | Refresh after upload/review/apply plus explicit retry | State changes are workflow-driven |
| Locations, Users, Modules, Rules, Kiosk, Settings | Load on entry and after mutation; manual where operationally useful | Configuration is not a live queue |
| Integration provider facts | Load on entry, after provider action, and explicit refresh | Provider calls may be expensive or rate-limited |

Automatic refresh requirements:

- pause while document is hidden;
- refresh on focus/visibility restoration;
- refresh on network recovery;
- allow only one in-flight request per data owner;
- abort or ignore stale responses;
- use backoff after repeated failures;
- stop on unmount;
- pause any refresh that could overwrite active unsaved editing;
- do not auto-refresh destructive confirmations or upload dialogs.

The current `useAutomaticRefresh` already provides visible-only `30s` polling, focus refresh, and overlap prevention. Keep it as the default owner and extend it for network recovery/backoff if implementation evidence justifies the change. The current workorder-detail `3s` owner needs explicit overlap protection before it becomes the product-wide near-real-time pattern.

### 5.3 Manual refresh behavior

- Label the action “Refresh” or “Refresh inventory”; do not rely on an icon alone on phone.
- Place it in the collection toolbar or page secondary-action menu.
- Disable repeated activation while the same request is running.
- Preserve current page, filters, sort, selected row, open drawer, scroll, and focus.
- Show immediate pressed/busy feedback within `100ms`.
- Announce completion only when useful. Avoid a toast every `30s` auto-refresh.
- Show “Last updated” only where freshness changes operator trust: Inventory projection, integration/provider data, offline queues, and stale fallback. Do not add timestamps to every static page.
- When refresh changes counts, update tabs and collection from one coherent snapshot or disclose temporary mismatch.

### 5.4 Refresh after mutation

After create, edit, assign, submit, receive, approve, or delete:

1. Acknowledge the action immediately.
2. Update the changed object optimistically only when rollback is safe and identity/state are known.
3. Revalidate the narrowest canonical owner: affected row/detail, active page, counts, then dependent summary.
4. Preserve the operator’s context.
5. If the object no longer matches filters, remove it and explain the transition rather than showing a mysterious disappearance.
6. Do not use full browser reload as routine reconciliation.

Inventory mutations must re-fetch authoritative/projection data according to existing Odoo/local boundaries. Client optimism must not invent quantity, serial, custody, sync, or provider truth.

## 6. Loading and rendering rules

- Skeletons match expected row/card geometry and render `5–8` placeholders, not an entire page size.
- Skeleton animation stops under reduced-motion preference.
- First meaningful data should not shift page title, filters, or pagination vertically.
- Background updates apply subtle opacity/progress only if text remains readable and clickable actions remain truthful.
- Large collections never mount unbounded phone rows.
- Images/documents lazy-load below the fold; primary identity assets may load eagerly.
- Detail drawers may fetch after opening but keep the source collection stable.
- Route transitions show the destination shell immediately.

## 7. Accessibility and interaction rules

- Collection uses a semantic HTML table when row/column relationships matter. ARIA table roles require equivalent keyboard/readout behavior and must not simulate semantics incompletely.
- Sort buttons expose active direction.
- Result totals and page changes use one polite live region; avoid announcing every background refresh.
- Errors use alerts only when immediate attention is required.
- Refresh icon has accessible name, visible tooltip on pointer devices, and `44px` phone target.
- Pagination controls meet `44px` phone and `40px` desktop targets.
- Focus remains stable during background refresh. DOM replacement must not throw focus to the page start.
- Selected row and expanded drawer state remain programmatically identifiable.

## 8. Per-page decisions

| Page/surface | Quantity rule | Refresh rule | Information rule |
| --- | --- | --- | --- |
| Admin Operations | `20` server | `30s`, focus/visibility recovery, manual retry | Reduce nine desktop columns to six primary where possible; fixed location not repeated |
| Mechanic/Office/Surveillance queues | `20` server records at every viewport; phone may progressively reveal within a loaded page only | `30s`, online/focus aware | One status, one next action, up to four phone facts |
| Inventory stock | `20` server | Manual and mutation-driven; show projection freshness when available | Identity, availability, location summary, one next action |
| Invoice history | `20` server | Query/mutation-driven; explicit retry | Status, vendor/invoice, amount/date, one workflow action |
| Part requests | `20` server | Host queue refresh key and mutation-driven | Waiting/supply state prioritized over secondary metadata |
| Locations | `20` client while bounded | Entry and mutation-driven | Name, type/readiness, concise next action |
| Location Users | `20` client initially; plan server search if scale continues | Entry and mutation-driven | Identity, role/state, one action menu |
| Modules | `20` client | Entry and save-driven | Summary only; full role matrix in manager |
| Kiosk devices/integration clients/invitations | `20` client | Entry, mutation, explicit refresh if provider/device state matters | Identity, state, one key fact, action menu |
| Workorder detail | One object plus bounded sections; histories `20` | Near-real-time `3s` only when safe; mutation-driven | Identity and concern once; sections add new detail |
| Settings/provider detail | One provider; every repeated child resource or mapping collection uses `20` | Entry, provider action, explicit refresh | One provider header; no duplicate card identity |

## 9. Stress-test findings and roadmap corrections

### Finding A — Mixed page sizes make collection behavior harder to predict

**Correction:** every collection defaults to `20` records. Page layout and visible fields still vary by task, but pagination quantity stays consistent.

### Finding B — Phone progressive disclosure and server pagination could appear contradictory

**Correction:** `ProgressiveQueue` controls rendering only within the loaded server page. Pagination controls fetch the next server page. UI must make both remaining counts understandable.

### Finding C — “Refresh” was treated as one action instead of a state model

**Correction:** initial loading, background update, stale-but-usable, offline, and blocking error now have separate rules. Existing content remains visible during revalidation.

### Finding D — Fast polling can overlap or overwrite edits

**Correction:** every polling owner requires single-flight behavior, stale-response protection, hidden-tab pause, cleanup, and edit-aware pause. Workorder detail’s current `3s` loop requires overlap verification.

### Finding E — Refresh could destroy context

**Correction:** refresh explicitly preserves page, filters, sort, selection, drawer, focus, and scroll. Only invalid/deleted selection may close, with explanation and focus recovery.

### Finding F — More columns can look “professional” while reducing scan quality

**Correction:** desktop gets column budgets and a two-timestamp limit. Mobile gets a fixed information budget rather than compressed table parity.

### Finding G — “Last updated” everywhere would add noise

**Correction:** freshness timestamps appear only for projection/provider/offline/stale data where trust depends on age.

### Finding H — Static settings should not inherit live-queue polling

**Correction:** settings/configuration load on entry and after mutation. Provider refresh remains explicit and rate-aware.

### Finding I — Live desktop queues and settings currently violate the 20-record rule

**Verified August 29 evidence:** Office mounted `197` Needs action workorders and `30` mechanics; Surveillance mounted as many as `81` workorders; Mechanic mounted `30` Available jobs; Modules split `14` records into two pages; Odoo exposed `249` mapping candidates and `529` controls in one composed page.

**Correction:** the `20` default is viewport-independent. Desktop does not receive an unbounded exception. A collection with `20` or fewer records renders one page and hides pagination. Office mechanic workload, role queues, module summaries, mappings, devices, clients, invitations, and every other repeated resource use the same quantity contract, with search/filtering appropriate to the task.

## 10. Implementation sequence additions

These tasks join Wave 0 of the frontend roadmap:

1. Define `CollectionToolbar` state contract: query, filters, sort, total, refresh state, and mobile disclosure slots.
2. Extend shared pagination tests for filter reset, page clamp, loading disablement, and focus behavior.
3. Preserve `ProgressiveQueue` as the single phone disclosure owner and document its server-page boundary.
4. Extend `useAutomaticRefresh` only after focused tests cover visibility, focus, network recovery, overlap, backoff, and cleanup.
5. Add a shared request-state model or narrow hook only after Inventory, Operations, and Invoice prove identical state transitions.
6. Add rendered fixtures for initial loading, background update, stale data, filtered empty, blocking error, and multi-page results.

Do not create a universal `DataTable` abstraction before two migrated pages prove the same markup, interaction, and responsive contract.

## 11. Acceptance checklist

- Page-size choice matches Section 2 and is documented beside non-standard exceptions.
- Desktop column count stays within its family budget.
- Phone card information stays within the stated content budget.
- Search/filter/sort reset page 1; refresh does not.
- Server and client pagination cannot produce an invalid empty page after mutation.
- Background refresh keeps current content visible.
- Auto-refresh pauses hidden, prevents overlap, rejects stale responses, and cleans up.
- Active editing cannot be overwritten by polling.
- Refresh failure retains last successful content and exposes retry.
- Manual refresh has a visible label on phone and immediate busy feedback.
- Page/detail context, focus, and scroll survive refresh.
- Filtered-empty and truly-empty states have different language/actions.
- Exact `390px`, `768px`, `1440px`, `320px`, and `200%` text checks pass where applicable.
- No full browser reload is used as routine data reconciliation.
- No quantity, identity, permission, status, provider, or freshness truth is invented client-side.

## 12. Review ledger

### August 28, 2026 — Live composition review

- Reordered roadmap around visible problems rather than source-page order.
- Promoted Inventory, Users, Settings, Modules, object-page de-duplication, and phone Template Preview.
- Protected Operations phone filters/cards, Locations navigation, Inventory detail drawer, workorder phone section dock, and access-panel proportions.
- Marked Mechanic, Office, Surveillance, standard sign in, and Kiosk as live-audit-gated.

### August 29, 2026 — Collection and refresh stress test

- Standardized every collection on a default page size of `20` following design review.
- Added desktop/tablet/phone information budgets.
- Clarified server pagination versus phone progressive rendering.
- Added initial/background/stale/offline/error refresh states.
- Added polling eligibility, interval defaults, overlap protection, edit safety, and context preservation.
- Added post-mutation reconciliation and freshness-label rules.
- Added per-page quantity and refresh decisions plus acceptance gates.

### August 29, 2026 — Precision UI/UX critic pass

- Kept the universal `20`-record default while adding row/card information budgets so equal counts do not create unequal cognitive load.
- Added minimum `12px` meaningful operational text, strict radius/depth rules, and exact gutter validation through the precision critic plan.
- Required reduced-motion, forced-colors, focus preservation, and component-aware accessibility verification alongside collection behavior.

### August 29, 2026 — Four-role live quantity audit

- Confirmed local-only Admin, Office, Mechanic, and Surveillance sessions through controlled QA accounts.
- Found unbounded Office, Mechanic, and Surveillance desktop queues plus an unbounded Office mechanic rail.
- Found Modules paginating fewer than `20` total records and Odoo rendering hundreds of mapping controls.
- Made the `20`-record rule viewport-independent and applicable to every repeated provider/settings resource.

Future design reviews append decisions here when they alter this contract. Implementation status belongs in delivery evidence, not this planning ledger.

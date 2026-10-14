import { Dropdown } from "../forms/Dropdown.jsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, FilterLines, Inbox01, SearchMd } from "@untitledui/icons";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { api } from "../../lib/api.js";
import { textEntryProps } from "../forms/text-entry-policy.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import { WorkorderDraftQueue } from "../../features/workorder-drafts/index.js";
import { ProgressiveQueue } from "../responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../responsive/ProgressiveQueue.js";
import { WorkorderQueueTabs } from "../workorders/WorkorderQueue.jsx";
import { CollectionPagination } from "../ui/CollectionPagination.jsx";
import { CheckpointQueueTable } from "./CheckpointQueueTable.jsx";
import { useCheckpointPages } from "./useCheckpointPages.js";
import { readCheckpointFilters, readCheckpointPosition, saveCheckpointFilters, saveCheckpointPosition } from "./checkpoint-position.js";
import { MobileQueueToolbar } from "./MobileQueueToolbar.jsx";
import {
  OperationalCollectionCell,
  OperationalCollectionRow,
  OperationalCollectionTable,
  OperationalCollectionToolbar,
} from "./OperationalCollectionPage.jsx";
import { PartRequestQueue } from "./PartRequestQueue.jsx";
import { usePartRequestQueueCount } from "./usePartRequestQueueCount.js";
import {
  ATTENTION_OPTIONS,
  LIFECYCLE_OPTIONS,
  OPERATION_CATEGORIES,
  SORT_OPTIONS,
  buildOperationsQuery,
  formatActivity,
  formatDuration,
  normalizeOperationsCategoryFilters,
  operationLabel,
  operationsCategoryFromSearch,
} from "./operations-format.js";
import "./operations.css";

const emptyCounts = {
  needsAttention: 0,
  unassigned: 0,
  active: 0,
  parts: 0,
  readyReview: 0,
  drafts: 0,
  odooBacklog: 0,
  all: 0,
};

const ADMIN_PRIMARY_CATEGORY_IDS = new Set(["needs_attention", "active", "ready_review"]);

export function buildMobileQueuePresentation(
  categories,
  activeCategoryId,
  primaryCategoryIds = ADMIN_PRIMARY_CATEGORY_IDS,
) {
  const defaultPrimary = categories.filter((category) => primaryCategoryIds.has(category.key));
  const activeCategory = categories.find((category) => category.key === activeCategoryId);
  const primary = activeCategory && !primaryCategoryIds.has(activeCategory.key)
    ? [...defaultPrimary.slice(0, -1), activeCategory]
    : defaultPrimary;
  const primaryKeys = new Set(primary.map((category) => category.key));

  return {
    primary,
    secondary: categories.filter((category) => !primaryKeys.has(category.key)),
  };
}

function OperationsFilters({
  filters,
  fixedLocationId,
  locations,
  onSearchChange,
  onUpdate,
  searchInput,
  fields = ["search", "locationId", "lifecycle", "attentionReason", "sort"],
}) {
  return (
    <>
      {fields.includes("search") ? <label className="operations-search">
        <span className="operations-field-label">Search workorders</span>
        <span className="operations-input-with-icon"><SearchMd /><input {...textEntryProps("search")} type="search" value={searchInput} onChange={(event) => onSearchChange(event.target.value)} placeholder="Unit, serial, concern" /></span>
      </label> : null}
      {fields.includes("locationId") && !fixedLocationId ? (
        <label>
          <span className="operations-field-label">Location</span>
          <Dropdown value={filters.locationId} onChange={(event) => onUpdate("locationId", event.target.value)}>
            <option value="">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </Dropdown>
        </label>
      ) : null}
      {fields.includes("lifecycle") ? <label>
        <span className="operations-field-label">Lifecycle</span>
        <Dropdown value={filters.lifecycle} onChange={(event) => onUpdate("lifecycle", event.target.value)}>
          {LIFECYCLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Dropdown>
      </label> : null}
      {fields.includes("attentionReason") ? <label>
        <span className="operations-field-label">Attention</span>
        <Dropdown value={filters.attentionReason} onChange={(event) => onUpdate("attentionReason", event.target.value)}>
          {ATTENTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Dropdown>
      </label> : null}
      {fields.includes("sort") ? <label>
        <span className="operations-field-label">Sort</span>
        <Dropdown value={filters.sort} onChange={(event) => onUpdate("sort", event.target.value)}>
          {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Dropdown>
      </label> : null}
    </>
  );
}

function OperationsFilterPopover({ label, active, column = false, children }) {
  return <DialogTrigger>
    <Button className={`operations-filter-trigger${column ? " is-column" : ""}${active ? " is-active" : ""}`} aria-label={column ? `${label} filters and sort` : label}>
      {column ? <span>{label}</span> : null}<FilterLines aria-hidden="true" />
    </Button>
    <Popover className="operations-filter-popover" placement="bottom end" offset={8}>
      <Dialog aria-label={label}>{({ close }) => <>
        <header><h3>{label}</h3><Button onPress={close}>Done</Button></header>
        <div className="operations-filter-fields">{children}</div>
      </>}</Dialog>
    </Popover>
  </DialogTrigger>;
}

function OperationRow({ item, onOpenWorkorder, ...rowProps }) {
  const attentionReasons = Array.isArray(item.attentionReasons) ? item.attentionReasons : [];
  const overdue = attentionReasons.includes("overdue");
  const attentionTone = ["overdue", "revision_requested", "parts", "office_help", "missing_info"]
    .find((reason) => attentionReasons.includes(reason)) || "";
  const activity = formatActivity(item.lastActivityAt || item.createdAt);
  const created = formatActivity(item.createdAt);
  const unit = item.asset?.unitNo || item.asset?.name || "No unit";
  const location = item.location?.name || "No location";
  const mechanic = item.mechanics?.map((member) => member.name).filter(Boolean).join(", ")
    || item.mechanic?.name
    || "Unassigned";
  const odooStatus = item.odooStatus || "not_entered";
  const odooStatusLabel = {
    entered: "Entered",
    missing_info: "Missing info",
    not_entered: "Not entered",
  }[odooStatus] || odooStatus.replaceAll("_", " ");
  const open = typeof onOpenWorkorder === "function" ? () => onOpenWorkorder(item.id) : undefined;

  return (
    <OperationalCollectionRow
      {...rowProps}
      className={`operations-row lifecycle-tone-${item.lifecycle || "unknown"}${item.unread ? " is-unread" : ""}${overdue ? " is-overdue" : ""}${attentionTone ? ` has-attention attention-tone-${attentionTone}` : ""}`}
      onAction={open}
      ariaLabel={`${item.serial || "Workorder"}, ${unit}, ${location}`}
    >
      <OperationalCollectionCell className="operations-cell operations-location" label="Location">
        <strong>{location}</strong>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-identity" label="Unit / workorder">
        <strong>{unit}</strong>
        <span>{item.serial || "No serial"}</span>
        <div className="operations-flags">
          {item.unread ? <span className="operations-flag unread"><Inbox01 />Unread</span> : null}
          {overdue ? <span className="operations-flag overdue"><Clock />Overdue</span> : null}
        </div>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-concern" label="Concern">
        <span title={item.concern || ""}>{item.concern || "No concern entered"}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className={`operations-cell operations-mechanic${item.mechanics?.length || item.mechanic ? "" : " is-unassigned"}`} label="Mechanics">
        {mechanic}
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-state" label="Lifecycle / attention">
        <span className={`operations-lifecycle lifecycle-${item.lifecycle || "unknown"}`}>{operationLabel(item.lifecycle)}</span>
        {attentionReasons.length ? (
          <div className="operations-attention-list">
            {attentionReasons.map((reason) => (
              <span className={`operations-attention-${reason}`} key={reason}>
                {operationLabel(reason, reason.replaceAll("_", " "))}
              </span>
            ))}
          </div>
        ) : <span className="operations-no-attention">No attention needed</span>}
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-wait" label="Time waiting">
        <strong>{formatDuration(item.timeInStatusSeconds)}</strong>
        <span>in status</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-created" label="Created / age">
        <strong>{created.relative}</strong>
        <span>{created.absolute}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-odoo" label="Odoo">
        <span className={`operations-odoo-state odoo-${odooStatus}`}>{odooStatusLabel}</span>
      </OperationalCollectionCell>
      <OperationalCollectionCell className="operations-cell operations-activity" label="Last activity">
        <strong>{activity.relative}</strong>
        <span>{activity.absolute}</span>
      </OperationalCollectionCell>
    </OperationalCollectionRow>
  );
}

function LoadingRows() {
  return (
    <div className="operations-loading" role="status" aria-label="Loading workorders">
      {Array.from({ length: 5 }, (_, index) => <span key={index} />)}
    </div>
  );
}

export function OperationsWorkspace({
  actor,
  checkpointScrolling = true,
  locations = [],
  fixedLocationId = "",
  drafts = [],
  draftLoading = false,
  draftError = "",
  draftBusyId = "",
  onOpenDraft,
  onDiscardDraft,
  onTakeoverDraft,
  onRefreshDrafts,
  onOpenWorkorder,
}) {
  const routeCategory = useMemo(
    () => operationsCategoryFromSearch(window.location.search),
    [],
  );
  const [filters, setFilters] = useState({
    category: routeCategory || "needs_attention",
    locationId: fixedLocationId,
    lifecycle: "",
    attentionReason: "",
    search: "",
    sort: "timeInStatus:desc",
  });
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [summary, setSummary] = useState({ counts: emptyCounts, loading: true, loaded: false, error: "" });
  const [legacyList, setList] = useState({ items: [], total: 0, pageCount: 1, loading: true, loaded: false, error: "" });
  const checkpointEnabled = checkpointScrolling && !["drafts", "parts"].includes(filters.category);
  const checkpointKey = JSON.stringify([actor?.id, fixedLocationId, filters]);
  const initialCheckpointPage = useMemo(() => readCheckpointPosition(checkpointKey)?.page || 1, [checkpointKey]);
  const fetchCheckpointPage = useCallback((page, { signal }) => api(`/api/admin/operations/workorders?${buildOperationsQuery(filters, page, 20)}`, { signal }), [filters]);
  const checkpointQueue = useCheckpointPages({
    queryKey: checkpointKey, fetchPage: fetchCheckpointPage, enabled: checkpointEnabled, refreshKey,
    initialPage: initialCheckpointPage,
  });
  const list = checkpointEnabled ? { ...checkpointQueue, items: checkpointQueue.pages.flatMap((batch) => batch.items) } : legacyList;
  const QueueTable = checkpointEnabled ? CheckpointQueueTable : OperationalCollectionTable;
  const [partFilters, setPartFilters] = useState({
    locationId: fixedLocationId,
    search: "",
    status: "",
    supply: "",
    sort: "waiting:desc",
  });
  const preferenceHydrated = useRef(false);
  const queuePreferences = useWorkorderPreferences("admin");
  useAutomaticRefresh(() => setRefreshKey((current) => current + 1));
  const partRequestCount = usePartRequestQueueCount({ locationId: fixedLocationId, refreshKey });

  function resetFilterPosition(next) {
    if (checkpointScrolling) saveCheckpointPosition(JSON.stringify([actor?.id, fixedLocationId, next]), { page: 1 });
    return next;
  }

  useEffect(() => {
    if (fixedLocationId || !queuePreferences.ready || preferenceHydrated.current) return;
    const saved = (checkpointScrolling && readCheckpointFilters(actor?.id)) || queuePreferences.filters;
    setFilters((current) => {
      const category = !routeCategory && OPERATION_CATEGORIES.some((item) => item.id === saved.category)
        ? saved.category
        : current.category;
      return normalizeOperationsCategoryFilters(category, {
        ...current,
        locationId: saved.locationId || "",
        lifecycle: saved.lifecycle || "",
        attentionReason: saved.attentionReason || "",
        search: saved.search || "",
        sort: SORT_OPTIONS.some(([value]) => value === saved.sort) ? saved.sort : current.sort,
      });
    });
    setSearchInput(saved.search || "");
    preferenceHydrated.current = true;
  }, [fixedLocationId, queuePreferences.ready, routeCategory]);

  useEffect(() => {
    if (fixedLocationId || !preferenceHydrated.current) return;
    if (checkpointScrolling) saveCheckpointFilters(actor?.id, filters);
    const { category, locationId, lifecycle, attentionReason, sort } = filters;
    queuePreferences.save(
      { category, locationId, lifecycle, attentionReason, sort },
      { defaultView: category, defaultLocationId: locationId || null },
    );
  }, [filters.category, filters.locationId, filters.lifecycle, filters.attentionReason, filters.search, filters.sort, fixedLocationId]);

  useEffect(() => {
    if (!fixedLocationId) return;
    setFilters((current) => ({ ...current, locationId: fixedLocationId }));
    setPartFilters((current) => ({ ...current, locationId: fixedLocationId }));
    setPage(1);
  }, [fixedLocationId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => current.search === searchInput ? current : resetFilterPosition({ ...current, search: searchInput }));
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (filters.locationId) params.set("locationId", filters.locationId);
    setSummary((current) => ({ ...current, loading: !current.loaded, error: "" }));
    api(`/api/admin/operations/summary${params.size ? `?${params}` : ""}`, { signal: controller.signal })
      .then((result) => setSummary({ counts: { ...emptyCounts, ...(result.counts || {}) }, loading: false, loaded: true, error: "" }))
      .catch((error) => {
        if (error.name !== "AbortError") setSummary((current) => ({ ...current, loading: false, loaded: true, error: error.message }));
      });
    return () => controller.abort();
  }, [filters.locationId, refreshKey]);

  useEffect(() => {
    const controller = new AbortController();
    if (checkpointEnabled) return () => controller.abort();
    if (filters.category === "drafts" || filters.category === "parts") {
      setList({
        items: [],
        total: drafts.filter((draft) => !fixedLocationId || draft.locationId === fixedLocationId).length,
        pageCount: 1,
        loading: false,
        loaded: true,
        error: "",
      });
      return () => controller.abort();
    }
    const query = buildOperationsQuery(filters, page, 20);
    setList((current) => ({ ...current, loading: !current.loaded, error: "" }));
    api(`/api/admin/operations/workorders?${query}`, { signal: controller.signal })
      .then((result) => setList({
        items: result.items || [],
        total: result.total || 0,
        pageCount: Math.max(1, result.pageCount || 1),
        loading: false,
        loaded: true,
        error: "",
      }))
      .catch((error) => {
        if (error.name !== "AbortError") setList((current) => ({ ...current, loading: false, loaded: true, error: error.message }));
      });
    return () => controller.abort();
  }, [drafts, filters, fixedLocationId, page, refreshKey, checkpointEnabled]);

  const activeCategory = useMemo(
    () => OPERATION_CATEGORIES.find((category) => category.id === filters.category) || OPERATION_CATEGORIES[0],
    [filters.category],
  );
  const visibleDraftCount = useMemo(
    () => drafts.filter((draft) => !fixedLocationId || draft.locationId === fixedLocationId).length,
    [drafts, fixedLocationId],
  );
  const categoryCounts = useMemo(
    () => ({
      ...summary.counts,
      drafts: visibleDraftCount,
      parts: partRequestCount.total,
    }),
    [summary.counts, visibleDraftCount, partRequestCount.total],
  );
  const mobileCategories = OPERATION_CATEGORIES.map((category) => ({
    key: category.id,
    label: category.label,
    count: categoryCounts[category.countKey],
  }));
  const mobileQueuePresentation = buildMobileQueuePresentation(mobileCategories, filters.category);
  const mobilePrimaryCategories = mobileQueuePresentation.primary;
  const mobileSecondaryCategories = mobileQueuePresentation.secondary;
  const mobileFiltersActive = Boolean(
    filters.search
    || filters.locationId
    || filters.lifecycle
    || filters.attentionReason
    || filters.sort !== "timeInStatus:desc"
    || !ADMIN_PRIMARY_CATEGORY_IDS.has(filters.category),
  );
  const hasNarrowingFilters = Boolean(
    filters.search
    || (!fixedLocationId && filters.locationId)
    || filters.lifecycle
    || filters.attentionReason
  );

  function updateFilter(key, value) {
    setFilters((current) => resetFilterPosition(
      key === "category"
        ? normalizeOperationsCategoryFilters(value, current)
        : { ...current, [key]: value }
    ));
    setPage(1);
  }

  function clearNarrowingFilters() {
    setSearchInput("");
    setFilters((current) => resetFilterPosition({
      ...current,
      locationId: fixedLocationId,
      lifecycle: "",
      attentionReason: "",
      search: "",
    }));
    setPage(1);
  }

  function refresh() {
    setRefreshKey((current) => current + 1);
  }

  function updatePartFilter(key, value) {
    setPartFilters((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="operations-workspace" aria-label="Workorder operations">
      <MobileQueueToolbar
        className="role-mobile-primary-queues"
        tabs={mobilePrimaryCategories}
        activeTab={filters.category}
        onChange={(category) => updateFilter("category", category)}
        label="Open admin queues, search, and filters"
        title="Queues, search, and filters"
        filtersActive={mobileFiltersActive}
        onClearFilters={() => {
          setSearchInput("");
          setFilters((current) => resetFilterPosition({
            ...current,
            category: "needs_attention",
            locationId: fixedLocationId,
            lifecycle: "",
            attentionReason: "",
            search: "",
            sort: "timeInStatus:desc",
          }));
          setPage(1);
        }}
      >
        <div className="role-mobile-secondary-queues">
          <WorkorderQueueTabs
            tabs={mobileSecondaryCategories}
            activeTab={filters.category}
            onChange={(category) => updateFilter("category", category)}
          />
        </div>
        {filters.category !== "drafts" && filters.category !== "parts" ? (
          <OperationalCollectionToolbar className="operations-toolbar">
            <OperationsFilters
              filters={filters}
              fixedLocationId={fixedLocationId}
              locations={locations}
              onSearchChange={setSearchInput}
              onUpdate={updateFilter}
              searchInput={searchInput}
            />
          </OperationalCollectionToolbar>
        ) : null}
      </MobileQueueToolbar>

      <OperationalCollectionToolbar className="operations-toolbar operations-toolbar-with-queue role-desktop-filters">
        <label className="operations-queue-field">
          <span className="operations-field-label">Queue</span>
          <Dropdown aria-label="Queue" value={filters.category} onChange={(event) => updateFilter("category", event.target.value)}>
            {OPERATION_CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.label} ({category.id === "parts" ? (partRequestCount.loaded ? categoryCounts.parts : "—") : category.id !== "drafts" && summary.loading ? "—" : categoryCounts[category.countKey]})</option>)}
          </Dropdown>
        </label>
        {filters.category !== "drafts" && filters.category !== "parts" ? <OperationsFilters
          filters={filters}
          fixedLocationId={fixedLocationId}
          locations={locations}
          onSearchChange={setSearchInput}
          onUpdate={updateFilter}
          searchInput={searchInput}
          fields={["search"]}
        /> : null}
      </OperationalCollectionToolbar>

      {filters.category !== "drafts" && filters.category !== "parts" && summary.error ? <p className="operations-inline-error" role="alert">Counts unavailable: {summary.error}</p> : null}
      <div className="operations-results-scroll">
        {filters.category === "drafts" ? (
        <WorkorderDraftQueue
          role={actor?.role}
          actorId={actor?.id}
          drafts={drafts}
          loading={draftLoading}
          error={draftError}
          busyId={draftBusyId}
          fixedLocationId={fixedLocationId}
          onOpen={onOpenDraft}
          onDiscard={onDiscardDraft}
          onTakeover={onTakeoverDraft}
          onRefresh={onRefreshDrafts}
        />
        ) : filters.category === "parts" ? (
        <PartRequestQueue
          filters={partFilters}
          locations={locations}
          fixedLocationId={fixedLocationId}
          onFiltersChange={updatePartFilter}
          onOpenWorkorder={onOpenWorkorder}
          refreshKey={refreshKey}
        />
        ) : <CollectionPagination enabled={!checkpointEnabled} currentPage={page} pageCount={list.pageCount} setPage={setPage} total={list.total} label="workorders" pageSize={20} loading={list.loading}>
        <QueueTable
        className="operations-table"
        ariaLabel={`${activeCategory.label} workorders`}
        busy={list.loading}
        queue={checkpointQueue}
        storageKey={checkpointKey}
        renderItem={(item) => <OperationRow item={item} onOpenWorkorder={onOpenWorkorder} />}
        columns={[
          { id: "location", label: fixedLocationId ? "Location" : <OperationsFilterPopover column label="Location" active={Boolean(filters.locationId)}><OperationsFilters filters={filters} locations={locations} onUpdate={updateFilter} fields={["locationId"]} /></OperationsFilterPopover> },
          { id: "identity", label: "Unit / workorder" },
          { id: "concern", label: "Concern" },
          { id: "mechanics", label: "Mechanics" },
          { id: "state", label: <OperationsFilterPopover column label="Lifecycle / attention" active={Boolean(filters.lifecycle || filters.attentionReason)}><OperationsFilters filters={filters} onUpdate={updateFilter} fields={["lifecycle", "attentionReason"]} /></OperationsFilterPopover> },
          { id: "waiting", label: <OperationsFilterPopover column label="Time waiting"><OperationsFilters filters={filters} onUpdate={updateFilter} fields={["sort"]} /></OperationsFilterPopover> },
          { id: "created", label: <OperationsFilterPopover column label="Created / age"><OperationsFilters filters={filters} onUpdate={updateFilter} fields={["sort"]} /></OperationsFilterPopover>, className: "operations-created" },
          { id: "odoo", label: "Odoo", className: "operations-odoo" },
          { id: "activity", label: <OperationsFilterPopover column label="Last activity"><OperationsFilters filters={filters} onUpdate={updateFilter} fields={["sort"]} /></OperationsFilterPopover> },
        ]}
      >
        {list.loading ? <LoadingRows /> : null}
        {!list.loading && list.error ? (
          <div className="operations-state-message error" role="alert">
            <strong>Workorders could not be loaded.</strong>
            <span>{list.error}</span>
            <button type="button" onClick={refresh}>Try again</button>
          </div>
        ) : null}
        {!list.loading && !list.error && !list.items.length ? (
          <div className="operations-state-message">
            <strong>No {activeCategory.label.toLowerCase()} workorders.</strong>
            {hasNarrowingFilters ? (
              <>
                <span>Current filters hide this queue.</span>
                <button type="button" onClick={clearNarrowingFilters}>Clear filters</button>
              </>
            ) : null}
          </div>
        ) : null}
        {!checkpointEnabled && !list.loading && !list.error ? (
          <ProgressiveQueue
            items={list.items}
            resetKey={progressiveQueueResetKey([
              filters.category,
              filters.locationId,
              filters.lifecycle,
              filters.attentionReason,
              filters.search,
              filters.sort,
              page,
            ])}
            renderItem={(item) => <OperationRow item={item} onOpenWorkorder={onOpenWorkorder} />}
          />
        ) : null}
        </QueueTable>
        </CollectionPagination>}
      </div>
    </section>
  );
}

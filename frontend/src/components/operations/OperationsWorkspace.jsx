import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock, Inbox01, SearchMd } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import { WorkorderDraftQueue } from "../../features/workorder-drafts/index.js";
import { ProgressiveQueue } from "../responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../responsive/ProgressiveQueue.js";
import { WorkorderQueueTabs } from "../workorders/WorkorderQueue.jsx";
import { MobileQueueToolbar } from "./MobileQueueToolbar.jsx";
import {
  ATTENTION_OPTIONS,
  LIFECYCLE_OPTIONS,
  OPERATION_CATEGORIES,
  SORT_OPTIONS,
  buildOperationsQuery,
  formatActivity,
  formatDuration,
  operationLabel,
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

function OperationsFilters({
  filters,
  fixedLocationId,
  locations,
  onSearchChange,
  onUpdate,
  searchInput,
}) {
  return (
    <>
      <label className="operations-search">
        <span className="operations-field-label">Search workorders</span>
        <span className="operations-input-with-icon"><SearchMd /><input type="search" value={searchInput} onChange={(event) => onSearchChange(event.target.value)} placeholder="Unit, serial, concern" /></span>
      </label>
      {!fixedLocationId ? (
        <label>
          <span className="operations-field-label">Location</span>
          <select value={filters.locationId} onChange={(event) => onUpdate("locationId", event.target.value)}>
            <option value="">All locations</option>
            {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
          </select>
        </label>
      ) : null}
      <label>
        <span className="operations-field-label">Lifecycle</span>
        <select value={filters.lifecycle} onChange={(event) => onUpdate("lifecycle", event.target.value)}>
          {LIFECYCLE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span className="operations-field-label">Attention</span>
        <select value={filters.attentionReason} onChange={(event) => onUpdate("attentionReason", event.target.value)}>
          {ATTENTION_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label>
        <span className="operations-field-label">Sort</span>
        <select value={filters.sort} onChange={(event) => onUpdate("sort", event.target.value)}>
          {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </>
  );
}

function OperationRow({ item, onOpenWorkorder }) {
  const attentionReasons = Array.isArray(item.attentionReasons) ? item.attentionReasons : [];
  const overdue = attentionReasons.includes("overdue");
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
  const interactive = typeof onOpenWorkorder === "function";

  function open() {
    if (interactive) onOpenWorkorder(item.id);
  }

  function handleKeyDown(event) {
    if (!interactive || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    open();
  }

  return (
    <div
      className={`operations-row${item.unread ? " is-unread" : ""}${overdue ? " is-overdue" : ""}${interactive ? " is-interactive" : ""}`}
      role="row"
      tabIndex={interactive ? 0 : undefined}
      onClick={open}
      onKeyDown={handleKeyDown}
      aria-label={`${item.serial || "Workorder"}, ${unit}, ${location}`}
    >
      <div className="operations-cell operations-location" role="cell" data-label="Location">
        <strong>{location}</strong>
      </div>
      <div className="operations-cell operations-identity" role="cell" data-label="Unit / workorder">
        <strong>{unit}</strong>
        <span>{item.serial || "No serial"}</span>
        <div className="operations-flags">
          {item.unread ? <span className="operations-flag unread"><Inbox01 />Unread</span> : null}
          {overdue ? <span className="operations-flag overdue"><Clock />Overdue</span> : null}
        </div>
      </div>
      <div className="operations-cell operations-concern" role="cell" data-label="Concern">
        <span title={item.concern || ""}>{item.concern || "No concern entered"}</span>
      </div>
      <div className={`operations-cell operations-mechanic${item.mechanics?.length || item.mechanic ? "" : " is-unassigned"}`} role="cell" data-label="Mechanics">
        {mechanic}
      </div>
      <div className="operations-cell operations-state" role="cell" data-label="Lifecycle / attention">
        <span className={`operations-lifecycle lifecycle-${item.lifecycle || "unknown"}`}>{operationLabel(item.lifecycle)}</span>
        {attentionReasons.length ? (
          <div className="operations-attention-list">
            {attentionReasons.map((reason) => <span key={reason}>{operationLabel(reason, reason.replaceAll("_", " "))}</span>)}
          </div>
        ) : <span className="operations-no-attention">No attention needed</span>}
      </div>
      <div className="operations-cell operations-wait" role="cell" data-label="Time waiting">
        <strong>{formatDuration(item.timeInStatusSeconds)}</strong>
        <span>in status</span>
      </div>
      <div className="operations-cell operations-created" role="cell" data-label="Created / age" title={created.absolute}>
        <strong>{created.relative}</strong>
        <span>{created.absolute}</span>
      </div>
      <div className="operations-cell operations-odoo" role="cell" data-label="Odoo">
        <span className={`operations-odoo-state odoo-${odooStatus}`}>{odooStatusLabel}</span>
      </div>
      <div className="operations-cell operations-activity" role="cell" data-label="Last activity" title={activity.absolute}>
        <strong>{activity.relative}</strong>
        <span>{activity.absolute}</span>
      </div>
    </div>
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
  const [filters, setFilters] = useState({
    category: new URLSearchParams(window.location.search).get("view") === "drafts" ? "drafts" : "needs_attention",
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
  const [list, setList] = useState({ items: [], total: 0, pageCount: 1, loading: true, loaded: false, error: "" });
  const preferenceHydrated = useRef(false);
  const legacyDraftRoute = useMemo(
    () => new URLSearchParams(window.location.search).get("view") === "drafts",
    [],
  );
  const queuePreferences = useWorkorderPreferences("admin");
  useAutomaticRefresh(() => setRefreshKey((current) => current + 1));

  useEffect(() => {
    if (fixedLocationId || !queuePreferences.ready || preferenceHydrated.current) return;
    const saved = queuePreferences.filters;
    setFilters((current) => ({
      ...current,
      category: !legacyDraftRoute && OPERATION_CATEGORIES.some((item) => item.id === saved.category)
        ? saved.category
        : current.category,
      locationId: saved.locationId || "",
      lifecycle: saved.lifecycle || "",
      attentionReason: saved.attentionReason || "",
      sort: SORT_OPTIONS.some(([value]) => value === saved.sort) ? saved.sort : current.sort,
    }));
    preferenceHydrated.current = true;
  }, [fixedLocationId, legacyDraftRoute, queuePreferences.ready]);

  useEffect(() => {
    if (fixedLocationId || !preferenceHydrated.current) return;
    const { category, locationId, lifecycle, attentionReason, sort } = filters;
    queuePreferences.save(
      { category, locationId, lifecycle, attentionReason, sort },
      { defaultView: category, defaultLocationId: locationId || null },
    );
  }, [filters.category, filters.locationId, filters.lifecycle, filters.attentionReason, filters.sort, fixedLocationId]);

  useEffect(() => {
    if (!fixedLocationId) return;
    setFilters((current) => ({ ...current, locationId: fixedLocationId }));
    setPage(1);
  }, [fixedLocationId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search: searchInput }));
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
    if (filters.category === "drafts") {
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
    const query = buildOperationsQuery(filters, page);
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
  }, [drafts, filters, fixedLocationId, page, refreshKey]);

  const activeCategory = useMemo(
    () => OPERATION_CATEGORIES.find((category) => category.id === filters.category) || OPERATION_CATEGORIES[0],
    [filters.category],
  );
  const visibleDraftCount = useMemo(
    () => drafts.filter((draft) => !fixedLocationId || draft.locationId === fixedLocationId).length,
    [drafts, fixedLocationId],
  );
  const categoryCounts = useMemo(
    () => ({ ...summary.counts, drafts: visibleDraftCount }),
    [summary.counts, visibleDraftCount],
  );
  const mobileCategories = OPERATION_CATEGORIES.map((category) => ({
    key: category.id,
    label: category.label,
    count: categoryCounts[category.countKey],
  }));
  const mobilePrimaryCategories = mobileCategories.filter((category) => ADMIN_PRIMARY_CATEGORY_IDS.has(category.key));
  const mobileSecondaryCategories = mobileCategories.filter((category) => !ADMIN_PRIMARY_CATEGORY_IDS.has(category.key));
  const mobileFiltersActive = Boolean(
    filters.search
    || filters.locationId
    || filters.lifecycle
    || filters.attentionReason
    || filters.sort !== "timeInStatus:desc"
    || !ADMIN_PRIMARY_CATEGORY_IDS.has(filters.category),
  );

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function refresh() {
    setRefreshKey((current) => current + 1);
  }

  return (
    <section className="operations-workspace" aria-label="Workorder operations">
      <div className="operations-tabs-wrap role-desktop-queues">
        <div className="operations-tabs" role="tablist" aria-label="Workorder categories">
          {OPERATION_CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={filters.category === category.id}
              className={filters.category === category.id ? "active" : ""}
              onClick={() => updateFilter("category", category.id)}
            >
              <span>{category.label}</span>
              <strong aria-label={`${categoryCounts[category.countKey]} ${category.id === "drafts" ? "drafts" : "workorders"}`}>
                {category.id !== "drafts" && summary.loading ? "-" : categoryCounts[category.countKey]}
              </strong>
            </button>
          ))}
        </div>
      </div>
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
          setFilters((current) => ({
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
        {filters.category !== "drafts" ? (
          <div className="operations-toolbar">
            <OperationsFilters
              filters={filters}
              fixedLocationId={fixedLocationId}
              locations={locations}
              onSearchChange={setSearchInput}
              onUpdate={updateFilter}
              searchInput={searchInput}
            />
          </div>
        ) : null}
      </MobileQueueToolbar>

      {filters.category !== "drafts" ? <div className="operations-toolbar role-desktop-filters">
        <OperationsFilters
          filters={filters}
          fixedLocationId={fixedLocationId}
          locations={locations}
          onSearchChange={setSearchInput}
          onUpdate={updateFilter}
          searchInput={searchInput}
        />
      </div> : null}

      {filters.category !== "drafts" && summary.error ? <p className="operations-inline-error" role="alert">Counts unavailable: {summary.error}</p> : null}
      <div className="operations-list-header">
        <span><strong>{activeCategory.label}</strong>{filters.category === "drafts" || !list.loading ? ` · ${filters.category === "drafts" ? visibleDraftCount : list.total}` : ""}</span>
        {filters.category !== "drafts" && filters.locationId && !fixedLocationId ? <span>{locations.find((location) => location.id === filters.locationId)?.name}</span> : null}
      </div>

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
      ) : <div className="operations-table" role="table" aria-label={`${activeCategory.label} workorders`} aria-busy={list.loading}>
        <div className="operations-table-head" role="row">
          <span role="columnheader">Location</span>
          <span role="columnheader">Unit / workorder</span>
          <span role="columnheader">Concern</span>
          <span role="columnheader">Mechanics</span>
          <span role="columnheader">Lifecycle / attention</span>
          <span role="columnheader">Time waiting</span>
          <span className="operations-created" role="columnheader">Created / age</span>
          <span className="operations-odoo" role="columnheader">Odoo</span>
          <span role="columnheader">Last activity</span>
        </div>
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
          </div>
        ) : null}
        {!list.loading && !list.error ? (
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
      </div>}

      {filters.category !== "drafts" && list.pageCount > 1 ? (
        <nav className="operations-pagination" aria-label="Workorder pages">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1}><ChevronLeft />Previous</button>
          <span>Page {page} of {list.pageCount}</span>
          <button type="button" onClick={() => setPage((current) => Math.min(list.pageCount, current + 1))} disabled={page >= list.pageCount}>Next<ChevronRight /></button>
        </nav>
      ) : null}
    </section>
  );
}

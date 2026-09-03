import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { RefreshCw01, SearchMd } from "@untitledui/icons";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { ProductModeSwitch } from "../../inspections/ProductModeSwitch.jsx";
import { WorkspaceHeader } from "../../../components/layout/WorkspaceHeader.jsx";
import { MobileQueueToolbar } from "../../../components/operations/MobileQueueToolbar.jsx";
import { ProgressiveQueue } from "../../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../../components/responsive/ProgressiveQueue.js";
import {
  WorkorderQueueTabs,
  WorkorderRow,
  WorkorderTableHeader,
} from "../../../components/workorders/WorkorderQueue.jsx";
import {
  SURVEILLANCE_PHONE_SECONDARY_TABS,
  isSurveillancePhonePrimaryTab,
} from "../surveillanceQueue.js";

export function SurveillanceQueueView({ actor, queue, onOpenWorkorder, inspectionAccess = { canRead: false }, product = "workorders", onProductChange, workorderAccess = { canRead: true } }) {
  const {
    activeDatePreset,
    activeTab,
    applyDatePreset,
    clearDates,
    clearFilters,
    compactTabs,
    customDateOpen,
    dashboard,
    dateEndFilter,
    dateStartFilter,
    effectiveLocationFilter,
    error,
    loading,
    locations,
    openCustomDate,
    rows,
    search,
    setActiveTab,
    setDateEndFilter,
    setDateStartFilter,
    setLocationFilter,
    setSearch,
    tabs,
  } = queue;

  const filtersActive = Boolean(search || effectiveLocationFilter || dateStartFilter || dateEndFilter);

  return (
    <main className="prototype mechanic-home surveillance-home workspace-operations">
      <WorkspaceHeader actor={actor} />
      <PageHeader title="Workorders" />
      {inspectionAccess.canRead && workorderAccess.canRead ? <ProductModeSwitch value={product} onChange={onProductChange} /> : null}
      <section className="mechanic-queue-shell surveillance-queue-shell">
        <div className="queue-toolbar surveillance-toolbar">
          <div className="surveillance-desktop-queues">
            <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          </div>
          <MobileQueueToolbar
            className="surveillance-compact-queues"
            tabs={compactTabs}
            activeTab={activeTab}
            onChange={setActiveTab}
            label="Open surveillance queues, search, and filters"
            title="Queues, search, and filters"
            filtersActive={filtersActive}
            onClearFilters={clearFilters}
          >
            <label>
              <span>Queue</span>
              <Dropdown aria-label="More surveillance queues" value={isSurveillancePhonePrimaryTab(activeTab) ? "" : activeTab} onChange={(event) => event.target.value && setActiveTab(event.target.value)}>
                <option value="">Choose queue</option>
                {SURVEILLANCE_PHONE_SECONDARY_TABS.map((phoneTab) => (
                  <option key={phoneTab.key} value={phoneTab.key}>
                    {phoneTab.label} ({dashboard?.counts[phoneTab.key] || 0})
                  </option>
                ))}
              </Dropdown>
            </label>
            <label className="mechanic-search">
              <SearchMd />
              <input {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, or location" aria-label="Search workorders" />
            </label>
            {locations.length > 1 ? (
              <label>
                <span>Location</span>
                <Dropdown value={effectiveLocationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter">
                  <option value="">All locations</option>
                  {locations.map((location) => <option key={location}>{location}</option>)}
                </Dropdown>
              </label>
            ) : null}
            <label><span>From</span><input type="date" value={dateStartFilter} onChange={(event) => setDateStartFilter(event.target.value)} aria-label="Activity date start filter" /></label>
            <label><span>To</span><input type="date" value={dateEndFilter} onChange={(event) => setDateEndFilter(event.target.value)} aria-label="Activity date end filter" /></label>
          </MobileQueueToolbar>
          <div className="surveillance-filter-row">
            <label className="mechanic-search"><SearchMd /><input {...textEntryProps("search")} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, or location" aria-label="Search workorders" /></label>
            {locations.length > 1 ? (
              <Dropdown value={effectiveLocationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter">
                <option value="">All locations</option>
                {locations.map((location) => <option key={location}>{location}</option>)}
              </Dropdown>
            ) : null}
            <label className="surveillance-date-filter surveillance-desktop-date">
              <span>From</span>
              <input type="date" value={dateStartFilter} onChange={(event) => setDateStartFilter(event.target.value)} aria-label="Activity date start filter" />
            </label>
            <label className="surveillance-date-filter surveillance-desktop-date">
              <span>To</span>
              <input type="date" value={dateEndFilter} onChange={(event) => setDateEndFilter(event.target.value)} aria-label="Activity date end filter" />
            </label>
            <div className="surveillance-compact-date-controls">
              <div className="surveillance-date-presets" aria-label="Activity date range">
                <button className={activeDatePreset === "today" ? "active" : ""} type="button" onClick={() => applyDatePreset("today")}>Today</button>
                <button className={activeDatePreset === "week" ? "active" : ""} type="button" onClick={() => applyDatePreset("week")}>This week</button>
                <button className={activeDatePreset === "custom" || customDateOpen ? "active" : ""} type="button" onClick={openCustomDate}>Custom</button>
              </div>
              {customDateOpen || activeDatePreset === "custom" ? (
                <div className="surveillance-custom-date-range">
                  <label><span>From</span><input type="date" value={dateStartFilter} onChange={(event) => setDateStartFilter(event.target.value)} aria-label="Custom activity date start" /></label>
                  <label><span>To</span><input type="date" value={dateEndFilter} onChange={(event) => setDateEndFilter(event.target.value)} aria-label="Custom activity date end" /></label>
                  {(dateStartFilter || dateEndFilter) ? <button type="button" onClick={clearDates}>Clear</button> : <span className="surveillance-any-date">All dates</span>}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        <WorkorderTableHeader variant="surveillance" />
        <div className="mechanic-work-list" aria-live="polite">
          {loading ? (
            <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
          ) : rows.length ? (
            <ProgressiveQueue
              items={rows}
              resetKey={progressiveQueueResetKey([activeTab, search, effectiveLocationFilter, dateStartFilter, dateEndFilter])}
              renderItem={(workorder) => (
                <WorkorderRow workorder={workorder} variant="surveillance" onOpen={() => onOpenWorkorder(workorder.id)} />
              )}
            />
          ) : (
            <div className="mechanic-empty-state">
              <strong>No matching workorders</strong>
              {filtersActive ? (
                <>
                  <span>Current filters hide this queue.</span>
                  <button type="button" onClick={clearFilters}>Clear filters</button>
                </>
              ) : null}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle, ClipboardCheck, Clock, RefreshCw01, SearchMd, Tool02 } from "@untitledui/icons";
import { ProfileMenu } from "../../components/account/ProfileMenu.jsx";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { MobileQueueTools } from "../../components/operations/MobileQueueTools.jsx";
import { PreviewPane, PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ProgressiveQueue } from "../../components/responsive/ProgressiveQueue.jsx";
import { progressiveQueueResetKey } from "../../components/responsive/ProgressiveQueue.js";
import { WorkorderDetailLayout } from "../../components/workorders/WorkorderDetailLayout.jsx";
import { CompactWorkorderPreview } from "../../components/workorders/CompactWorkorderPreview.jsx";
import { ProgressiveWorkorderSection, WorkorderObjectSummary, WorkorderSectionNav } from "../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { WorkorderTimelinePanel } from "../../components/workorders/WorkorderTimeline.jsx";
import { WorkorderStatusPill } from "../../components/workorders/WorkorderStatusPill.jsx";
import { PreviewFullscreen, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import { buildCompactPhoneDetailSections } from "../workorder-detail/workorder-detail-sections.js";
import { useWorkorderDetailRealtime } from "../workorder-detail/useWorkorderDetailRealtime.js";
import { normalizeWorkorderFormData, workDateRangeLabel, workorderPhysicalPageCount, workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import {
  SURVEILLANCE_PHONE_PRIMARY_TABS,
  SURVEILLANCE_PHONE_SECONDARY_TABS,
  isSurveillancePhonePrimaryTab,
} from "./surveillanceQueue.js";
import "./surveillance.css";

function valueOrDash(value) {
  return value || "-";
}

function localDate(value) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function matchesDateFilter(value, startDate, endDate) {
  if (!startDate && !endDate) return true;
  const date = localDate(value);
  if (!date) return false;
  if (startDate && endDate) {
    const rangeStart = startDate <= endDate ? startDate : endDate;
    const rangeEnd = startDate <= endDate ? endDate : startDate;
    return date >= rangeStart && date <= rangeEnd;
  }
  if (startDate) return date === startDate;
  return date <= endDate;
}

function dateInputValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function datePresetRange(preset) {
  const today = new Date();
  if (preset === "today") {
    const value = dateInputValue(today);
    return { start: value, end: value };
  }
  if (preset === "week") {
    const start = new Date(today);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    return { start: dateInputValue(start), end: dateInputValue(today) };
  }
  return null;
}

function activeDatePreset(startDate, endDate) {
  if (!startDate && !endDate) return "all";
  const today = datePresetRange("today");
  if (startDate === today.start && endDate === today.end) return "today";
  const week = datePresetRange("week");
  if (startDate === week.start && endDate === week.end) return "week";
  return "custom";
}

function isCompactViewport() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;
}

function missingFields(workorder) {
  return [
    !workorder.concern ? "Concern" : "",
    !workorder.diagnosis ? "Diagnosis" : "",
    !workorder.workPerformed ? "Work performed" : "",
    !workorder.asset?.unitNo && !workorder.asset?.name ? "Unit" : "",
    !(workorder.mechanics?.length || workorder.mechanic?.name) ? "Mechanic" : "",
  ].filter(Boolean);
}

function progressTimestamp(workorder) {
  if (workorder.status === "accepted") return { label: "Accepted", value: workorder.acceptedAt };
  if (workorder.status === "in_progress") return { label: "Started", value: workorder.startedAt || workorder.acceptedAt };
  if (workorder.status === "mechanic_done") return { label: "Finished", value: workorder.mechanicDoneAt };
  return { label: "Approved", value: workorder.closedAt };
}

export function SurveillanceWorkspace({ actor }) {
  const isPhone = useMediaQuery("(max-width: 640px)");
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("active");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [dateStartFilter, setDateStartFilter] = useState("");
  const [dateEndFilter, setDateEndFilter] = useState("");
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailSection, setDetailSection] = useState("work");
  const [previewOpen, setPreviewOpen] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 760));
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [odooServiceOrderNo, setOdooServiceOrderNo] = useState("");
  const [odooNote, setOdooNote] = useState("");
  const [saving, setSaving] = useState(false);
  const previewRef = useRef(null);
  const preferenceHydrated = useRef(false);
  const compactQueueDefaultApplied = useRef(false);
  const queuePreferences = useWorkorderPreferences("surveillance");

  async function loadDashboard() {
    setError("");
    try {
      const result = await api("/api/surveillance/dashboard");
      setDashboard(result);
      return result;
    } catch (loadError) {
      setError(loadError.message);
      return null;
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadDashboard(); }, []);
  useAutomaticRefresh(loadDashboard);

  useEffect(() => {
    if (!queuePreferences.ready || preferenceHydrated.current) return;
    const saved = queuePreferences.filters;
    if (["active", "awaitingOffice", "pendingOdoo", "missingInfo", "entered"].includes(saved.activeTab)) setActiveTab(saved.activeTab);
    setLocationFilter(saved.locationFilter || "");
    setDateStartFilter(saved.dateStartFilter || saved.dateFilter || "");
    setDateEndFilter(saved.dateEndFilter || "");
    preferenceHydrated.current = true;
  }, [queuePreferences.ready]);

  useEffect(() => {
    if (!preferenceHydrated.current) return;
    queuePreferences.save(
      {
        activeTab,
        locationFilter,
        dateFilter: dateStartFilter,
        dateStartFilter,
        dateEndFilter,
      },
      { defaultView: activeTab },
    );
  }, [activeTab, locationFilter, dateStartFilter, dateEndFilter]);

  useEffect(() => {
    if (!dashboard || !queuePreferences.ready || compactQueueDefaultApplied.current) return;
    compactQueueDefaultApplied.current = true;
    if (isCompactViewport() && activeTab === "active" && (dashboard.counts.pendingOdoo || 0) > 0) {
      setActiveTab("pendingOdoo");
    }
  }, [dashboard, queuePreferences.ready]);

  const tabs = [
    { key: "active", label: "Active", count: dashboard?.counts.active || 0, icon: Clock },
    { key: "awaitingOffice", label: "Awaiting office", count: dashboard?.counts.awaitingOffice || 0, icon: CheckCircle },
    { key: "pendingOdoo", label: "Needs Odoo", count: dashboard?.counts.pendingOdoo || 0, icon: ClipboardCheck },
    { key: "missingInfo", label: "Missing info", count: dashboard?.counts.missingInfo || 0, icon: Tool02 },
    { key: "entered", label: "Entered", count: dashboard?.counts.entered || 0, icon: CheckCircle },
  ];
  const compactTabs = SURVEILLANCE_PHONE_PRIMARY_TABS.map((phoneTab) => ({
    ...tabs.find(({ key }) => key === phoneTab.key),
    label: phoneTab.label,
  }));
  const allRows = useMemo(() => [
    ...(dashboard?.active || []),
    ...(dashboard?.awaitingOffice || []),
    ...(dashboard?.pendingOdoo || []),
    ...(dashboard?.missingInfo || []),
    ...(dashboard?.entered || []),
  ], [dashboard]);
  const locations = useMemo(() => [...new Set(allRows.map((row) => row.locationName).filter(Boolean))].sort(), [allRows]);
  const effectiveLocationFilter = locations.includes(locationFilter) ? locationFilter : "";
  const rows = useMemo(() => (dashboard?.[activeTab] || [])
    .filter((workorder) => workorderMatchesSearch(workorder, search))
    .filter((workorder) => !effectiveLocationFilter || workorder.locationName === effectiveLocationFilter)
    .filter((workorder) => matchesDateFilter(workorder.closedAt || workorder.updatedAt, dateStartFilter, dateEndFilter)), [dashboard, activeTab, search, effectiveLocationFilter, dateStartFilter, dateEndFilter]);

  async function openWorkorder(id) {
    setError("");
    try {
      setDetail(await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`));
      setDetailSection("work");
      setFullscreenPageIndex(0);
      setOdooServiceOrderNo("");
      setOdooNote("");
    } catch (openError) {
      setError(openError.message);
    }
  }

  useWorkorderDetailRealtime({
    enabled: Boolean(detail?.workorder?.id),
    workorderId: detail?.workorder?.id,
    paused: saving,
    onRefresh: async () => {
      const refreshed = await api(`/api/surveillance/workorders/${encodeURIComponent(detail.workorder.id)}`);
      setDetail(refreshed);
    },
  });

  function openRelative(offset) {
    const currentIndex = rows.findIndex((row) => row.id === detail?.workorder?.id);
    const next = rows[currentIndex + offset];
    if (next) openWorkorder(next.id);
  }

  function togglePreview() {
    if (typeof window !== "undefined" && window.innerWidth <= 760) {
      setPreviewFullscreen(true);
      return;
    }
    setPreviewOpen((open) => !open);
  }

  async function finishAndAdvance(request) {
    setSaving(true);
    setError("");
    const currentId = detail?.workorder?.id;
    const currentIndex = rows.findIndex((row) => row.id === currentId);
    try {
      await request(currentId);
      const nextDashboard = await loadDashboard();
      const nextRows = nextDashboard?.[activeTab] || [];
      const next = nextRows[Math.min(currentIndex, Math.max(0, nextRows.length - 1))];
      if (next && next.id !== currentId) await openWorkorder(next.id);
      else setDetail(null);
      setOdooServiceOrderNo("");
      setOdooNote("");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function markEntered(event) {
    event.preventDefault();
    if (!detail?.workorder?.id || !odooServiceOrderNo.trim()) return;
    finishAndAdvance((id) => api(`/api/surveillance/workorders/${encodeURIComponent(id)}/mark-odoo-entered`, {
      method: "POST",
      body: JSON.stringify({ odooServiceOrderNo: odooServiceOrderNo.trim(), note: odooNote.trim() }),
    }));
  }

  function markMissingInfo() {
    if (!detail?.workorder?.id || !odooNote.trim()) return;
    finishAndAdvance((id) => api(`/api/surveillance/workorders/${encodeURIComponent(id)}/mark-missing-info`, {
      method: "POST",
      body: JSON.stringify({ note: odooNote.trim() }),
    }));
  }

  function applyDatePreset(preset) {
    const range = datePresetRange(preset);
    if (!range) return;
    setCustomDateOpen(false);
    setDateStartFilter(range.start);
    setDateEndFilter(range.end);
  }

  if (detail) {
    const workorder = detail.workorder;
    const formData = workorder.formData || {};
    const unitType = workorder.asset?.unitType || formData.unitType || "Vehicle";
    const mechanicNames = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || workorder.mechanic?.name;
    const usedParts = (formData.parts || []).filter((part) => part.partNo || part.description || part.repairOrder);
    const missing = missingFields(workorder);
    const currentIndex = rows.findIndex((row) => row.id === workorder.id);
    const canProcessOdoo = ["closed", "odoo_entered"].includes(workorder.status);
    const progress = progressTimestamp(workorder);
    const baseDetailSections = [
      {
        id: "work",
        label: canProcessOdoo ? "Odoo" : "Work",
        attention: canProcessOdoo && missing.length > 0,
      },
      {
        id: "parts",
        label: "Parts",
        count: usedParts.length || undefined,
      },
      {
        id: "unit",
        label: unitType || "Unit",
      },
      {
        id: "activity",
        label: "Activity",
        count: detail.timeline?.length || undefined,
      },
    ];
    const detailSections = isPhone
      ? buildCompactPhoneDetailSections(baseDetailSections, "surveillance")
      : baseDetailSections;
    const selectedSection = detailSections.some((section) => section.id === detailSection) ? detailSection : "work";
    const workDates = workDateRangeLabel({
      workStartDate: formData.workStartDate || workorder.workStartDate || workorder.createdAt,
      workEndDate: formData.workEndDate || workorder.workEndDate || formData.workStartDate || workorder.createdAt,
    });
    const customerName = workorder.customerCompanyName || formData.customerCompanyName || formData.companyName;
    const assetLabel = workorder.asset?.unitNo || workorder.asset?.name;
    const previewForm = normalizeWorkorderFormData({
      ...formData,
      mechanicConcern: formData.mechanicConcern || workorder.concern || "",
      customerCompanyName: customerName || "",
      unitNo: formData.unitNo || assetLabel || "",
      unitType: formData.unitType || unitType || "",
      model: formData.model || workorder.asset?.model || "",
      vinNo: formData.vinNo || workorder.asset?.vin || "",
      licenseNo: formData.licenseNo || workorder.asset?.licensePlate || "",
      workStartDate: formData.workStartDate || formData.workDate || workorder.workStartDate || localDate(workorder.createdAt),
      workEndDate: formData.workEndDate || workorder.workEndDate || formData.workStartDate || formData.workDate || localDate(workorder.createdAt),
      parts: Array.isArray(formData.parts) ? formData.parts : [],
    }, { assetOwnerName: customerName || "" });
    const pageCount = workorderPhysicalPageCount(previewForm);
    const vehicleLabel = [
      formData.model || workorder.asset?.model,
      formData.mileage ? `${formData.mileage} mi` : "",
    ].filter(Boolean).join(" · ");
    return (
      <main className="prototype workorder-detail-page surveillance-detail-page">
        <style>{workorderTemplateStyles}</style>
        <WorkorderDetailLayout detail previewOpen={!isPhone && previewOpen}>
        <section className="surveillance-detail-shell control-panel">
          <div className="detail-context-bar">
            <button className="icon-button" type="button" onClick={() => setDetail(null)} aria-label="Back to surveillance queue" title="Back to queue"><ArrowLeft /></button>
            <div>
              <strong>{valueOrDash(assetLabel || workorder.serial)}</strong>
              <span>{workorder.serial}</span>
            </div>
            <div className="detail-context-actions">
              <WorkorderStatusPill status={workorder.status} />
              <nav className="surveillance-batch-nav" aria-label="Batch navigation">
                <button type="button" onClick={() => openRelative(-1)} disabled={currentIndex <= 0} aria-label="Previous workorder"><ArrowLeft /></button>
                <span>{currentIndex >= 0 ? `${currentIndex + 1} of ${rows.length}` : ""}</span>
                <button type="button" onClick={() => openRelative(1)} disabled={currentIndex < 0 || currentIndex >= rows.length - 1} aria-label="Next workorder"><ArrowRight /></button>
              </nav>
              {!isPhone ? (
                <PreviewToggle
                  open={previewOpen || previewFullscreen}
                  onToggle={togglePreview}
                  controls="workorder-preview-panel"
                />
              ) : null}
            </div>
          </div>

          {error ? <p className="ops-error" role="alert">{error}</p> : null}

          <WorkorderObjectSummary
            concern={workorder.concern}
            customer={customerName}
            dates={workDates}
            location={workorder.location?.name}
            mechanics={mechanicNames}
            unit={assetLabel}
            unitType={unitType}
          >
            <div className="workorder-object-inline-detail surveillance-inline-detail">
              <span>{unitType} details</span>
              <strong>{vehicleLabel || valueOrDash(formData.model || workorder.asset?.model)}</strong>
              <span>{progress.label}</span>
              <strong>{valueOrDash(progress.value ? new Date(progress.value).toLocaleString() : "")}</strong>
            </div>
          </WorkorderObjectSummary>

          <WorkorderSectionNav sections={detailSections} activeSection={selectedSection} onSelect={setDetailSection} />

          <div className="accordion-stack workorder-progressive-stack surveillance-detail-sections">
            <ProgressiveWorkorderSection
              id="work"
              title={canProcessOdoo ? "Odoo service order" : "Work progress"}
              summary={canProcessOdoo ? "Enter Odoo details or send back for information" : "Monitor mechanic and office progress"}
              activeSection={selectedSection}
              onSelect={setDetailSection}
              attention={canProcessOdoo && missing.length > 0}
              displayMode="panel"
            >
              <div className="surveillance-work-panel">
                <div className="surveillance-copy-grid">
                  <div><span>Concern</span><p>{valueOrDash(workorder.concern)}</p></div>
                  <div><span>Diagnosis</span><p>{valueOrDash(workorder.diagnosis)}</p></div>
                  <div><span>Work performed</span><p>{valueOrDash(workorder.workPerformed)}</p></div>
                </div>
                {canProcessOdoo ? (
                  <form className="surveillance-odoo-form" onSubmit={markEntered}>
                    {missing.length ? <div className="surveillance-missing"><strong>Missing information</strong><span>{missing.join(", ")}</span></div> : <p className="surveillance-complete">Workorder information complete</p>}
                    <label><span>Service order no.</span><input value={odooServiceOrderNo} onChange={(event) => setOdooServiceOrderNo(event.target.value)} /></label>
                    <label><span>Note</span><textarea value={odooNote} onChange={(event) => setOdooNote(event.target.value)} rows="3" /></label>
                    <div className="surveillance-odoo-actions">
                      <Button variant="primary" type="submit" disabled={saving || !odooServiceOrderNo.trim()}>{saving ? "Saving..." : "Mark entered"}</Button>
                      <Button variant="secondary" type="button" onClick={markMissingInfo} disabled={saving || !odooNote.trim()}>Send back for information</Button>
                    </div>
                  </form>
                ) : (
                  <div className="surveillance-progress-state">
                    <h3>{workorder.status === "mechanic_done" ? "Awaiting office approval" : "Work in progress"}</h3>
                    <p>{workorder.status === "mechanic_done"
                      ? "The mechanic finished this workorder. It moves to Needs Odoo when office approves it."
                      : "This workorder is active. Odoo entry becomes available after the mechanic finishes and office approves it."}</p>
                  </div>
                )}
              </div>
            </ProgressiveWorkorderSection>

            <ProgressiveWorkorderSection
              id="parts"
              title="Parts used"
              summary={usedParts.length ? `${usedParts.length} recorded` : "No parts recorded"}
              activeSection={selectedSection}
              onSelect={setDetailSection}
              displayMode="panel"
            >
              <div className="surveillance-parts-list">
                {usedParts.length ? usedParts.map((part, index) => (
                  <div key={`${part.partNo || part.description}-${index}`}>
                    <strong>{valueOrDash(part.partNo || part.description)}</strong>
                    <span>Qty {part.qty || 1}</span>
                    <p>{part.repairOrder || part.description || ""}</p>
                  </div>
                )) : <p>No parts recorded.</p>}
              </div>
            </ProgressiveWorkorderSection>

            <ProgressiveWorkorderSection
              id="unit"
              title={`${unitType || "Unit"} details`}
              summary={[assetLabel, customerName].filter(Boolean).join(" · ") || "Unit and customer information"}
              activeSection={selectedSection}
              onSelect={setDetailSection}
              displayMode="panel"
            >
              <dl className="surveillance-readonly-grid">
                <div><dt>Unit</dt><dd>{valueOrDash(assetLabel)}</dd></div>
                <div><dt>Type</dt><dd>{valueOrDash(unitType)}</dd></div>
                <div><dt>VIN</dt><dd>{valueOrDash(formData.vinNo || workorder.asset?.vin)}</dd></div>
                <div><dt>License</dt><dd>{valueOrDash(formData.licenseNo || workorder.asset?.licensePlate)}</dd></div>
                <div><dt>Model</dt><dd>{valueOrDash(formData.model || workorder.asset?.model)}</dd></div>
                <div><dt>Mileage</dt><dd>{formData.mileage ? `${formData.mileage} mi` : "Not listed"}</dd></div>
                <div><dt>Customer</dt><dd>{valueOrDash(customerName)}</dd></div>
                <div><dt>Location</dt><dd>{valueOrDash(workorder.location?.name)}</dd></div>
              </dl>
            </ProgressiveWorkorderSection>

            <ProgressiveWorkorderSection
              id="activity"
              title="Activity"
              summary={`${detail.timeline?.length || 0} ${(detail.timeline?.length || 0) === 1 ? "event" : "events"}`}
              activeSection={selectedSection}
              onSelect={setDetailSection}
              displayMode="panel"
            >
              <WorkorderTimelinePanel
                timeline={detail.timeline || []}
                participants={detail.participants || []}
                compact={isPhone}
              />
            </ProgressiveWorkorderSection>
            {isPhone && selectedSection === "preview" ? (
              <CompactWorkorderPreview
                panelRef={previewRef}
                status={<WorkorderStatusPill status={workorder.status} />}
                countLabel="1 workorder"
                range={workorder.serial}
                onFullscreen={() => setPreviewFullscreen(true)}
              >
                <div className="preview-grid single mechanic-preview-grid">
                  <WorkorderPreview label="First page" serial={workorder.serial} form={previewForm} />
                  {pageCount > 1
                    ? <WorkorderPreview label="Last page" serial={workorder.serial} form={previewForm} pageIndex={pageCount - 1} />
                    : null}
                </div>
              </CompactWorkorderPreview>
            ) : null}
          </div>
        </section>
        {!isPhone ? <PreviewPane
          id="workorder-preview-panel"
          open={previewOpen}
          variant="dock"
          panelRef={previewRef}
          status={<WorkorderStatusPill status={workorder.status} />}
          countLabel="1 workorder"
          range={workorder.serial}
          onFullscreen={() => setPreviewFullscreen(true)}
          onOpenPreview={() => setPreviewFullscreen(true)}
        >
          <div className="preview-grid single mechanic-preview-grid">
            <WorkorderPreview label="First page" serial={workorder.serial} form={previewForm} />
            {pageCount > 1
              ? <WorkorderPreview label="Last page" serial={workorder.serial} form={previewForm} pageIndex={pageCount - 1} />
              : null}
          </div>
        </PreviewPane> : null}
        </WorkorderDetailLayout>
        <PreviewFullscreen
          open={previewFullscreen}
          form={previewForm}
          serials={[workorder.serial]}
          pageIndex={fullscreenPageIndex}
          zoom={fullscreenZoom}
          range={workorder.serial}
          countLabel="1 workorder"
          actionLabel="Preview workorder"
          onClose={() => setPreviewFullscreen(false)}
          onPageChange={setFullscreenPageIndex}
          onZoomChange={setFullscreenZoom}
        />
      </main>
    );
  }

  return (
    <main className="prototype mechanic-home surveillance-home workspace-operations">
      <WorkspaceHeader actor={actor} />
      <PageHeader title="Workorders" />
      <section className="mechanic-queue-shell surveillance-queue-shell">
        <div className="queue-toolbar surveillance-toolbar">
          <div className="surveillance-desktop-queues">
            <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          </div>
          <div className="surveillance-compact-queues">
            <WorkorderQueueTabs tabs={compactTabs} activeTab={activeTab} onChange={setActiveTab} />
            <MobileQueueTools
              label="Open surveillance queues, search, and filters"
              title="Queues, search, and filters"
              filtersActive={Boolean(search || effectiveLocationFilter || dateStartFilter || dateEndFilter)}
              onClearFilters={() => { setSearch(""); setLocationFilter(""); setDateStartFilter(""); setDateEndFilter(""); setCustomDateOpen(false); }}
            >
              <label>
                <span>Queue</span>
                <select aria-label="More surveillance queues" value={isSurveillancePhonePrimaryTab(activeTab) ? "" : activeTab} onChange={(event) => event.target.value && setActiveTab(event.target.value)}>
                  <option value="">Choose queue</option>
                  {SURVEILLANCE_PHONE_SECONDARY_TABS.map((phoneTab) => <option key={phoneTab.key} value={phoneTab.key}>{phoneTab.label} ({dashboard?.counts[phoneTab.key] || 0})</option>)}
                </select>
              </label>
              <label className="mechanic-search"><SearchMd /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, or location" aria-label="Search workorders" /></label>
              {locations.length > 1 ? <label><span>Location</span><select value={effectiveLocationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter"><option value="">All locations</option>{locations.map((location) => <option key={location}>{location}</option>)}</select></label> : null}
              <label><span>From</span><input type="date" value={dateStartFilter} onChange={(event) => setDateStartFilter(event.target.value)} aria-label="Activity date start filter" /></label>
              <label><span>To</span><input type="date" value={dateEndFilter} onChange={(event) => setDateEndFilter(event.target.value)} aria-label="Activity date end filter" /></label>
            </MobileQueueTools>
          </div>
          <div className="surveillance-filter-row">
            <label className="mechanic-search"><SearchMd /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, or location" aria-label="Search workorders" /></label>
            {locations.length > 1 ? <select value={effectiveLocationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter"><option value="">All locations</option>{locations.map((location) => <option key={location}>{location}</option>)}</select> : null}
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
                <button className={activeDatePreset(dateStartFilter, dateEndFilter) === "today" ? "active" : ""} type="button" onClick={() => applyDatePreset("today")}>Today</button>
                <button className={activeDatePreset(dateStartFilter, dateEndFilter) === "week" ? "active" : ""} type="button" onClick={() => applyDatePreset("week")}>This week</button>
                <button className={activeDatePreset(dateStartFilter, dateEndFilter) === "custom" || customDateOpen ? "active" : ""} type="button" onClick={() => {
                  setCustomDateOpen(true);
                  if (!dateStartFilter && !dateEndFilter) {
                    const today = dateInputValue(new Date());
                    setDateStartFilter(today);
                    setDateEndFilter(today);
                  }
                }}>Custom</button>
              </div>
              {customDateOpen || activeDatePreset(dateStartFilter, dateEndFilter) === "custom" ? (
                <div className="surveillance-custom-date-range">
                  <label><span>From</span><input type="date" value={dateStartFilter} onChange={(event) => setDateStartFilter(event.target.value)} aria-label="Custom activity date start" /></label>
                  <label><span>To</span><input type="date" value={dateEndFilter} onChange={(event) => setDateEndFilter(event.target.value)} aria-label="Custom activity date end" /></label>
                  {(dateStartFilter || dateEndFilter) ? <button type="button" onClick={() => { setDateStartFilter(""); setDateEndFilter(""); setCustomDateOpen(false); }}>Clear</button> : <span className="surveillance-any-date">All dates</span>}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        <WorkorderTableHeader variant="surveillance" />
        <div className="mechanic-work-list" aria-live="polite">
          {loading ? <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
            : rows.length ? (
              <ProgressiveQueue
                items={rows}
                resetKey={progressiveQueueResetKey([
                  activeTab,
                  search,
                  effectiveLocationFilter,
                  dateStartFilter,
                  dateEndFilter,
                ])}
                renderItem={(workorder) => (
                  <WorkorderRow workorder={workorder} variant="surveillance" onOpen={() => openWorkorder(workorder.id)} />
                )}
              />
            )
              : <div className="mechanic-empty-state"><strong>No matching workorders</strong></div>}
        </div>
      </section>
    </main>
  );
}

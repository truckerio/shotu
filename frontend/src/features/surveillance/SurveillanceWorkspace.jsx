import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle, ClipboardCheck, RefreshCw01, SearchMd, Tool02 } from "@untitledui/icons";
import { ProfileMenu } from "../../components/account/ProfileMenu.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { WorkorderQueueTabs, WorkorderRow, WorkorderTableHeader, workorderMatchesSearch } from "../../components/workorders/WorkorderQueue.jsx";
import { WorkorderTimelinePanel } from "../../components/workorders/WorkorderTimeline.jsx";
import { WorkorderStatusPill } from "../../components/workorders/WorkorderStatusPill.jsx";
import { api } from "../../lib/api.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
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

function missingFields(workorder) {
  return [
    !workorder.concern ? "Concern" : "",
    !workorder.diagnosis ? "Diagnosis" : "",
    !workorder.workPerformed ? "Work performed" : "",
    !workorder.asset?.unitNo && !workorder.asset?.name ? "Unit" : "",
    !(workorder.mechanics?.length || workorder.mechanic?.name) ? "Mechanic" : "",
  ].filter(Boolean);
}

export function SurveillanceWorkspace({ actor }) {
  const [dashboard, setDashboard] = useState(null);
  const [activeTab, setActiveTab] = useState("pendingOdoo");
  const [search, setSearch] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState(null);
  const [odooServiceOrderNo, setOdooServiceOrderNo] = useState("");
  const [odooNote, setOdooNote] = useState("");
  const [saving, setSaving] = useState(false);
  const preferenceHydrated = useRef(false);
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
    if (["pendingOdoo", "missingInfo", "entered"].includes(saved.activeTab)) setActiveTab(saved.activeTab);
    setLocationFilter(saved.locationFilter || "");
    setDateFilter(saved.dateFilter || "");
    preferenceHydrated.current = true;
  }, [queuePreferences.ready]);

  useEffect(() => {
    if (!preferenceHydrated.current) return;
    queuePreferences.save(
      { activeTab, locationFilter, dateFilter },
      { defaultView: activeTab },
    );
  }, [activeTab, locationFilter, dateFilter]);

  const tabs = [
    { key: "pendingOdoo", label: "Needs Odoo", count: dashboard?.counts.pendingOdoo || 0, icon: ClipboardCheck },
    { key: "missingInfo", label: "Missing info", count: dashboard?.counts.missingInfo || 0, icon: Tool02 },
    { key: "entered", label: "Entered", count: dashboard?.counts.entered || 0, icon: CheckCircle },
  ];
  const allRows = useMemo(() => [...(dashboard?.pendingOdoo || []), ...(dashboard?.missingInfo || []), ...(dashboard?.entered || [])], [dashboard]);
  const locations = useMemo(() => [...new Set(allRows.map((row) => row.locationName).filter(Boolean))].sort(), [allRows]);
  const rows = useMemo(() => (dashboard?.[activeTab] || [])
    .filter((workorder) => workorderMatchesSearch(workorder, search))
    .filter((workorder) => !locationFilter || workorder.locationName === locationFilter)
    .filter((workorder) => !dateFilter || localDate(workorder.closedAt || workorder.updatedAt) === dateFilter), [dashboard, activeTab, search, locationFilter, dateFilter]);

  async function openWorkorder(id) {
    setError("");
    try {
      setDetail(await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`));
      setOdooServiceOrderNo("");
      setOdooNote("");
    } catch (openError) {
      setError(openError.message);
    }
  }

  function openRelative(offset) {
    const currentIndex = rows.findIndex((row) => row.id === detail?.workorder?.id);
    const next = rows[currentIndex + offset];
    if (next) openWorkorder(next.id);
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

  if (detail) {
    const workorder = detail.workorder;
    const formData = workorder.formData || {};
    const unitType = workorder.asset?.unitType || formData.unitType || "Vehicle";
    const mechanicNames = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || workorder.mechanic?.name;
    const usedParts = (formData.parts || []).filter((part) => part.partNo || part.description || part.repairOrder);
    const missing = missingFields(workorder);
    const currentIndex = rows.findIndex((row) => row.id === workorder.id);
    return (
      <main className="prototype surveillance-detail">
        <header className="surveillance-detail-header">
          <ProfileMenu actor={actor} />
          <button className="icon-button" type="button" onClick={() => setDetail(null)} aria-label="Back to completed workorders" title="Back"><ArrowLeft /></button>
          <div className="surveillance-detail-title"><strong>{workorder.serial}</strong><span>{valueOrDash(workorder.asset?.unitNo || workorder.asset?.name)}</span></div>
          <WorkorderStatusPill status={workorder.status} />
          <nav className="surveillance-batch-nav" aria-label="Batch navigation">
            <button type="button" onClick={() => openRelative(-1)} disabled={currentIndex <= 0} aria-label="Previous workorder"><ArrowLeft /></button>
            <span>{currentIndex >= 0 ? `${currentIndex + 1} of ${rows.length}` : ""}</span>
            <button type="button" onClick={() => openRelative(1)} disabled={currentIndex < 0 || currentIndex >= rows.length - 1} aria-label="Next workorder"><ArrowRight /></button>
          </nav>
        </header>

        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        <div className="surveillance-detail-layout">
          <section className="surveillance-record" aria-label="Completed workorder">
            <div className="surveillance-record-grid">
              <div><span>{unitType}</span><strong>{valueOrDash(workorder.asset?.unitNo || workorder.asset?.name)}</strong></div>
              <div><span>Mechanics</span><strong>{valueOrDash(mechanicNames)}</strong></div>
              <div><span>Location</span><strong>{valueOrDash(workorder.location?.name)}</strong></div>
              <div><span>Closed</span><strong>{valueOrDash(workorder.closedAt ? new Date(workorder.closedAt).toLocaleString() : "")}</strong></div>
            </div>
            <div className="surveillance-copy-block"><span>Concern</span><p>{valueOrDash(workorder.concern)}</p></div>
            <div className="surveillance-copy-block"><span>Diagnosis</span><p>{valueOrDash(workorder.diagnosis)}</p></div>
            <div className="surveillance-copy-block"><span>Work performed</span><p>{valueOrDash(workorder.workPerformed)}</p></div>
            <div className="surveillance-parts">
              <span>Parts used</span>
              {usedParts.length ? usedParts.map((part, index) => (
                <div key={`${part.partNo || part.description}-${index}`}><strong>{valueOrDash(part.partNo || part.description)}</strong><span>Qty {part.qty || 1}</span><p>{part.repairOrder || part.description || ""}</p></div>
              )) : <p>No parts recorded.</p>}
            </div>
          </section>

          <aside className="surveillance-odoo-panel">
            <form onSubmit={markEntered}>
              <h2>Odoo service order</h2>
              {missing.length ? <div className="surveillance-missing"><strong>Missing</strong><span>{missing.join(", ")}</span></div> : <p className="surveillance-complete">Workorder information complete</p>}
              <label><span>Service order no.</span><input value={odooServiceOrderNo} onChange={(event) => setOdooServiceOrderNo(event.target.value)} /></label>
              <label><span>Note</span><textarea value={odooNote} onChange={(event) => setOdooNote(event.target.value)} rows="3" /></label>
              <button type="submit" disabled={saving || !odooServiceOrderNo.trim()}>{saving ? "Saving..." : "Mark entered"}</button>
              <button className="surveillance-missing-button" type="button" onClick={markMissingInfo} disabled={saving || !odooNote.trim()}>Send back for information</button>
            </form>
          </aside>
        </div>
        <WorkorderTimelinePanel timeline={detail.timeline || []} participants={detail.participants || []} />
      </main>
    );
  }

  return (
    <main className="prototype mechanic-home surveillance-home workspace-operations">
      <WorkspaceHeader actor={actor} />
      <section className="mechanic-queue-shell surveillance-queue-shell">
        <div className="queue-toolbar surveillance-toolbar">
          <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />
          <div className="surveillance-filter-row">
            <label className="mechanic-search"><SearchMd /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search unit, workorder, or location" aria-label="Search completed workorders" /></label>
            {locations.length > 1 ? <select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)} aria-label="Location filter"><option value="">All locations</option>{locations.map((location) => <option key={location}>{location}</option>)}</select> : null}
            <input type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} aria-label="Completed date filter" />
          </div>
        </div>
        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        <WorkorderTableHeader variant="surveillance" />
        <div className="mechanic-work-list" aria-live="polite">
          {loading ? <div className="mechanic-empty-state"><RefreshCw01 className="loading-icon" /><strong>Loading workorders</strong></div>
            : rows.length ? rows.map((workorder) => <WorkorderRow key={workorder.id} workorder={workorder} variant="surveillance" onOpen={() => openWorkorder(workorder.id)} />)
              : <div className="mechanic-empty-state"><strong>No matching workorders</strong></div>}
        </div>
      </section>
    </main>
  );
}

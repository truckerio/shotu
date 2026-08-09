import {
  ArrowLeft,
  File02,
  Key01,
  MarkerPin01,
  Plus,
  Settings01,
  Tool02,
  Users01,
} from "@untitledui/icons";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { OperationsWorkspace } from "../../../components/operations/OperationsWorkspace.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { KioskSettingsPanel } from "../KioskSettingsPanel.jsx";
import { locationHasTemplate } from "../adminLocationStatus.js";
import { TemplatePage, WorkorderRulesPage } from "./TemplatePage.jsx";
import { UsersPage } from "./UsersPage.jsx";

export function LocationsPage({ locations, loading, onCreate, onOpen }) {
  return (
    <section className="admin-content">
      <PageHeader
        title="Locations"
        actions={<Button variant="primary" icon={Plus} onClick={onCreate}>New location</Button>}
      />
      <div className="admin-location-table">
        <div className="admin-table-head"><span>Location</span><span>Assigned active</span><span>Open work</span><span>Template</span><span></span></div>
        {loading ? <div className="admin-empty">Loading locations</div> : locations.map((location) => (
          <button className="admin-location-row" type="button" key={location.id} onClick={() => onOpen(location.id)}>
            <span className="admin-location-name"><span className="admin-location-icon"><MarkerPin01 /></span><span><strong>{location.name}</strong><small>{location.address || location.type}</small></span></span>
            <span className="admin-location-stat"><small>Assigned active</small><strong>{location.assigned_active_user_count ?? location.user_count ?? 0}</strong></span>
            <span className="admin-location-stat"><small>Open work</small><strong>{location.open_workorder_count}</strong></span>
            <span className={`admin-location-stat ${locationHasTemplate(location) ? "admin-ready" : "admin-muted"}`}><small>Template</small><strong>{locationHasTemplate(location) ? "Ready" : "Missing"}</strong></span>
            <span className="admin-location-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function LocationDetailPage({
  actor,
  detail,
  draftQueue,
  tab,
  setTab,
  template,
  setTemplate,
  policy,
  setPolicy,
  onBack,
  onInvite,
  onManageUser,
  onResendInvite,
  resendingInviteId,
  onSaveTemplate,
  onSavePolicy,
  onOpenModules,
  saving,
  onOpenWorkorder,
}) {
  return (
    <section className="admin-content">
      <PageHeader
        title={detail.location.name}
        subtitle={detail.location.address || detail.location.type}
        leading={<button className="admin-back" type="button" onClick={onBack} aria-label="Back to locations"><ArrowLeft /></button>}
      />
      <nav className="admin-tabs" aria-label="Location settings">
        <button className={tab === "work" ? "active" : ""} type="button" onClick={() => setTab("work")}><Tool02 /> Work</button>
        <button className={tab === "users" ? "active" : ""} type="button" onClick={() => setTab("users")}><Users01 /> Users</button>
        <button className={tab === "template" ? "active" : ""} type="button" onClick={() => setTab("template")}><File02 /> Template</button>
        <button className={tab === "rules" ? "active" : ""} type="button" onClick={() => setTab("rules")}><Settings01 /> Rules</button>
        <button className={tab === "kiosk" ? "active" : ""} type="button" onClick={() => setTab("kiosk")}><Key01 /> Kiosk</button>
      </nav>
      {tab === "work" ? <div className="admin-location-work"><OperationsWorkspace actor={actor} locations={[detail.location]} fixedLocationId={detail.location.id} {...draftQueue} onOpenWorkorder={onOpenWorkorder} /></div> : null}
      {tab === "users" ? <UsersPage actor={actor} detail={detail} onInvite={onInvite} onManage={onManageUser} onResend={onResendInvite} resendingId={resendingInviteId} /> : null}
      {tab === "template" ? <TemplatePage detail={detail} value={template} onChange={(key, value) => setTemplate((current) => ({ ...current, [key]: value }))} onSave={onSaveTemplate} saving={saving} /> : null}
      {tab === "rules" ? <WorkorderRulesPage detail={detail} policy={policy} onChange={setPolicy} onOpenModules={onOpenModules} onSave={onSavePolicy} saving={saving} /> : null}
      {tab === "kiosk" ? <KioskSettingsPanel locationId={detail.location.id} /> : null}
    </section>
  );
}

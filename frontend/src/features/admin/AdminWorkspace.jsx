import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy01, File02, Mail01, MarkerPin01, Plus, RefreshCw01, Tool02, Users01, XClose } from "@untitledui/icons";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { OperationsWorkspace } from "../../components/operations/OperationsWorkspace.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { emptyPart, renderWorkorderPageHtml, workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import "./admin.css";

const blankLocation = { name: "", type: "yard", address: "" };
const blankInvite = { name: "", email: "", role: "mechanic" };

function templateForm(template, location) {
  return {
    headerTitle: template?.header_title || `${location.name.toUpperCase()} WORKORDER`,
    brandTop: template?.brand_top || "PRO TEC",
    brandBottom: template?.brand_bottom || "REPAIR",
    warrantyText: template?.warranty_text || "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
    responsibilityText: template?.responsibility_text || "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
    authorizationText: template?.authorization_text || "I authorize the above repair to be completed along with necessary material(s).",
  };
}

function previewForm(location, template) {
  return {
    ...template,
    companyName: location.name,
    mechanicConcern: "Air leak inspection",
    unitNo: "1042",
    unitType: "Truck",
    workStartDate: new Date().toISOString().slice(0, 10),
    workEndDate: new Date().toISOString().slice(0, 10),
    licenseNo: "8ABC123",
    mileage: "428,190",
    model: "Cascadia",
    vinNo: "1FUJ...1042",
    mechanicName: "Mechanic Name",
    startTime: "08:00",
    endTime: "",
    managerName: "",
    customerSignature: "",
    authorizedBy: "",
    parts: [emptyPart(), emptyPart(), emptyPart()],
  };
}

function Modal({ title, children, onClose }) {
  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="admin-modal" role="dialog" aria-modal="true" aria-label={title}>
        <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close"><XClose /></button></header>
        {children}
      </section>
    </div>
  );
}

function LocationsHome({ locations, loading, onRefresh, onCreate, onOpen }) {
  return (
    <section className="admin-content">
      <div className="admin-title-row">
        <h1>Locations</h1>
        <div className="admin-actions">
          <button className="icon-button" type="button" onClick={onRefresh} title="Refresh" aria-label="Refresh locations"><RefreshCw01 /></button>
          <Button variant="primary" icon={Plus} onClick={onCreate}>New location</Button>
        </div>
      </div>
      <div className="admin-location-table">
        <div className="admin-table-head"><span>Location</span><span>Users</span><span>Open work</span><span>Template</span><span></span></div>
        {loading ? <div className="admin-empty"><RefreshCw01 className="loading-icon" /> Loading locations</div> : locations.map((location) => (
          <button className="admin-location-row" type="button" key={location.id} onClick={() => onOpen(location.id)}>
            <span className="admin-location-name"><span className="admin-location-icon"><MarkerPin01 /></span><span><strong>{location.name}</strong><small>{location.address || location.type}</small></span></span>
            <span>{location.user_count}</span>
            <span>{location.open_workorder_count}</span>
            <span className={location.has_template ? "admin-ready" : "admin-muted"}>{location.has_template ? "Ready" : "Missing"}</span>
            <span>›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function OperationsHome({ locations, onOpenWorkorder, onCreateWorkorder }) {
  return (
    <section className="admin-content admin-operations-content">
      <div className="admin-title-row">
        <h1>Operations</h1>
        {onCreateWorkorder ? <Button variant="primary" icon={Plus} onClick={onCreateWorkorder}>New workorder</Button> : null}
      </div>
      <OperationsWorkspace locations={locations} onOpenWorkorder={onOpenWorkorder} />
    </section>
  );
}

function UsersPanel({ detail, onInvite }) {
  return (
    <section className="admin-panel">
      <header className="admin-panel-header"><h2>Users</h2><Button variant="primary" icon={Mail01} onClick={onInvite}>Invite user</Button></header>
      <div className="admin-users-table">
        <div className="admin-users-head"><span>User</span><span>Role</span><span>Status</span></div>
        {detail.users.length ? detail.users.map((user) => (
          <div className="admin-user-row" key={user.id}>
            <span><strong>{user.name}</strong><small>{user.email}</small></span><span className="admin-role">{user.role}</span><span>{user.active && user.membership_active ? "Active" : "Inactive"}</span>
          </div>
        )) : <div className="admin-empty">No users assigned.</div>}
      </div>
      {detail.invitations.some((invite) => invite.status === "pending") ? (
        <div className="admin-pending"><strong>Pending invitations</strong>{detail.invitations.filter((invite) => invite.status === "pending").map((invite) => <span key={invite.id}>{invite.email} · {invite.role}</span>)}</div>
      ) : null}
    </section>
  );
}

function TemplatePanel({ detail, value, onChange, onSave, saving }) {
  const preview = useMemo(() => previewForm(detail.location, value), [detail.location, value]);
  return (
    <section className="admin-template-layout">
      <div className="admin-template-form">
        <div className="admin-panel-header"><h2>Workorder template</h2><Button variant="primary" onClick={onSave} disabled={saving}>{saving ? "Saving" : "Save template"}</Button></div>
        <label><span>Header title</span><input value={value.headerTitle} onChange={(event) => onChange("headerTitle", event.target.value)} /></label>
        <div className="admin-two-col"><label><span>Brand top</span><input value={value.brandTop} onChange={(event) => onChange("brandTop", event.target.value)} /></label><label><span>Brand bottom</span><input value={value.brandBottom} onChange={(event) => onChange("brandBottom", event.target.value)} /></label></div>
        <label><span>Warranty footer</span><input value={value.warrantyText} onChange={(event) => onChange("warrantyText", event.target.value)} /></label>
        <label><span>Responsibility footer</span><textarea rows="3" value={value.responsibilityText} onChange={(event) => onChange("responsibilityText", event.target.value)} /></label>
        <label><span>Authorization footer</span><textarea rows="5" value={value.authorizationText} onChange={(event) => onChange("authorizationText", event.target.value)} /></label>
      </div>
      <div className="admin-template-preview"><div dangerouslySetInnerHTML={{ __html: renderWorkorderPageHtml(preview, "WO-000001") }} /></div>
    </section>
  );
}

function LocationDetail({ detail, tab, setTab, template, setTemplate, onBack, onInvite, onSaveTemplate, saving, onOpenWorkorder }) {
  return (
    <section className="admin-content">
      <div className="admin-detail-title">
        <button className="admin-back" type="button" onClick={onBack} aria-label="Back to locations"><ArrowLeft /></button>
        <div><h1>{detail.location.name}</h1><p>{detail.location.address || detail.location.type}</p></div>
      </div>
      <nav className="admin-tabs" aria-label="Location settings">
        <button className={tab === "work" ? "active" : ""} type="button" onClick={() => setTab("work")}><Tool02 /> Work</button>
        <button className={tab === "users" ? "active" : ""} type="button" onClick={() => setTab("users")}><Users01 /> Users <span>{detail.users.length}</span></button>
        <button className={tab === "template" ? "active" : ""} type="button" onClick={() => setTab("template")}><File02 /> Template</button>
      </nav>
      {tab === "work" ? <div className="admin-location-work"><OperationsWorkspace locations={[detail.location]} fixedLocationId={detail.location.id} onOpenWorkorder={onOpenWorkorder} /></div> : null}
      {tab === "users" ? <UsersPanel detail={detail} onInvite={onInvite} /> : null}
      {tab === "template" ? <TemplatePanel detail={detail} value={template} onChange={(key, value) => setTemplate((current) => ({ ...current, [key]: value }))} onSave={onSaveTemplate} saving={saving} /> : null}
    </section>
  );
}

export function AdminWorkspace({ actor, onOpenWorkorder, onCreateWorkorder }) {
  const [locations, setLocations] = useState([]);
  const [view, setView] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("adminLocation") || params.get("adminView") === "locations" ? "locations" : "operations";
  });
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("work");
  const [template, setTemplate] = useState(null);
  const [modal, setModal] = useState("");
  const [locationDraft, setLocationDraft] = useState(blankLocation);
  const [inviteDraft, setInviteDraft] = useState(blankInvite);
  const [inviteUrl, setInviteUrl] = useState("");
  const [state, setState] = useState({ loading: true, busy: false, error: "", message: "" });

  async function loadLocations() {
    const result = await api("/api/admin/locations");
    setLocations(result.locations || []);
    setState((current) => ({ ...current, loading: false, error: "" }));
  }
  async function openLocation(id) {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const result = await api(`/api/admin/locations/${id}`);
    setView("locations");
    setSelectedId(id);
    setDetail(result);
    setTemplate(templateForm(result.template, result.location));
    setTab("work");
    setState((current) => ({ ...current, loading: false }));
    window.history.replaceState({}, "", `/?adminLocation=${encodeURIComponent(id)}`);
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("adminLocation");
    loadLocations()
      .then(() => id ? openLocation(id) : null)
      .catch((error) => setState({ loading: false, busy: false, error: error.message, message: "" }));
  }, []);

  function changeView(nextView) {
    setView(nextView);
    setSelectedId(null);
    setDetail(null);
    setTab("work");
    window.history.replaceState({}, "", `/?adminView=${nextView}`);
  }

  async function createLocation(event) {
    event.preventDefault();
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await api("/api/admin/locations", { method: "POST", body: JSON.stringify(locationDraft) });
      setModal(""); setLocationDraft(blankLocation); await loadLocations(); await openLocation(result.location.id);
    } catch (error) { setState((current) => ({ ...current, busy: false, error: error.message })); }
  }
  async function createInvite(event) {
    event.preventDefault();
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await api(`/api/admin/locations/${selectedId}/invitations`, { method: "POST", body: JSON.stringify(inviteDraft) });
      setInviteUrl(result.inviteUrl); setState((current) => ({ ...current, busy: false })); await openLocation(selectedId);
    } catch (error) { setState((current) => ({ ...current, busy: false, error: error.message })); }
  }
  async function saveTemplate() {
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      await api(`/api/admin/locations/${selectedId}/template`, { method: "PUT", body: JSON.stringify(template) });
      setState((current) => ({ ...current, busy: false, message: "Template saved." }));
      await openLocation(selectedId); setTab("template");
    } catch (error) { setState((current) => ({ ...current, busy: false, error: error.message })); }
  }

  return (
    <main className="admin-shell">
      <style>{workorderTemplateStyles}</style>
      <WorkspaceHeader actor={actor} className="admin-workspace-header">
        <nav className="admin-primary-nav" aria-label="Admin workspace">
          <button className={view === "operations" ? "active" : ""} type="button" onClick={() => changeView("operations")}><Tool02 />Operations</button>
          <button className={view === "locations" ? "active" : ""} type="button" onClick={() => changeView("locations")}><MarkerPin01 />Locations</button>
        </nav>
      </WorkspaceHeader>
      {state.error ? <p className="admin-error" role="alert">{state.error}</p> : null}
      {view === "operations" ? <OperationsHome locations={locations} onOpenWorkorder={onOpenWorkorder} onCreateWorkorder={onCreateWorkorder} /> : null}
      {view === "locations" && selectedId && detail ? <LocationDetail detail={detail} tab={tab} setTab={setTab} template={template} setTemplate={setTemplate} onBack={() => { setSelectedId(null); setDetail(null); window.history.replaceState({}, "", "/?adminView=locations"); loadLocations(); }} onInvite={() => { setInviteDraft(blankInvite); setInviteUrl(""); setModal("invite"); }} onSaveTemplate={saveTemplate} saving={state.busy} onOpenWorkorder={onOpenWorkorder} /> : null}
      {view === "locations" && !(selectedId && detail) ? <LocationsHome locations={locations} loading={state.loading} onRefresh={() => loadLocations().catch((error) => setState((current) => ({ ...current, error: error.message })))} onCreate={() => setModal("location")} onOpen={(id) => openLocation(id).catch((error) => setState((current) => ({ ...current, error: error.message })))} /> : null}
      {modal === "location" ? <Modal title="New location" onClose={() => setModal("")}><form className="admin-modal-form" onSubmit={createLocation}><label><span>Name</span><input required value={locationDraft.name} onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Type</span><select value={locationDraft.type} onChange={(event) => setLocationDraft((current) => ({ ...current, type: event.target.value }))}><option value="yard">Yard</option><option value="shop">Shop</option><option value="office">Office</option></select></label><label><span>Address</span><input value={locationDraft.address} onChange={(event) => setLocationDraft((current) => ({ ...current, address: event.target.value }))} /></label><Button variant="primary" type="submit" disabled={state.busy}>Create location</Button></form></Modal> : null}
      {modal === "invite" ? <Modal title="Invite user" onClose={() => setModal("")}><form className="admin-modal-form" onSubmit={createInvite}><label><span>Name</span><input required value={inviteDraft.name} onChange={(event) => setInviteDraft((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Email</span><input required type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} /></label><label><span>Role</span><select value={inviteDraft.role} onChange={(event) => setInviteDraft((current) => ({ ...current, role: event.target.value }))}><option value="mechanic">Mechanic</option><option value="office">Office</option><option value="surveillance">Surveillance</option></select></label>{inviteUrl ? <div className="admin-invite-result"><span>Invite link</span><code>{inviteUrl}</code><Button icon={Copy01} onClick={() => navigator.clipboard.writeText(inviteUrl)}>Copy link</Button></div> : <Button variant="primary" type="submit" disabled={state.busy}>Create invite</Button>}</form></Modal> : null}
    </main>
  );
}

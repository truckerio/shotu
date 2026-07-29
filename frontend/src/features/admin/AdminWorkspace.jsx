import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Copy01,
  DotsVertical,
  File02,
  Key01,
  Lock01,
  Mail01,
  MarkerPin01,
  Passcode,
  Plus,
  Settings01,
  Tool02,
  Trash01,
  UserCheck01,
  UserX01,
  Users01,
  XClose,
} from "@untitledui/icons";
import {
  Button as AriaButton,
  Menu,
  MenuItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import { PageHeader } from "../../components/layout/PageHeader.jsx";
import { WorkspaceHeader } from "../../components/layout/WorkspaceHeader.jsx";
import { ProfileMenu } from "../../components/account/ProfileMenu.jsx";
import { OperationsWorkspace } from "../../components/operations/OperationsWorkspace.jsx";
import { PasswordVisibilityToggle } from "../../components/ui/PasswordVisibilityToggle.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { api } from "../../lib/api.js";
import { emptyPart, renderWorkorderPageHtml, workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import {
  isCompleteKioskPin,
  kioskPinValue,
} from "../kiosk/kiosk-utils.js";
import { IntegrationsSettings } from "./integrations/IntegrationsSettings.jsx";
import { KioskSettingsPanel } from "./KioskSettingsPanel.jsx";
import { kioskPinFieldError } from "./kiosk-admin-errors.js";
import {
  ADMIN_MOBILE_DESTINATIONS,
  adminMobileDestinationState,
  initialAdminView,
} from "./adminNavigation.js";
import "./admin.css";

const blankLocation = { name: "", type: "yard", address: "" };
const blankInvite = { name: "", email: "", role: "mechanic" };
const blankPassword = { password: "", confirmation: "" };
const hiddenPasswords = { password: false, confirmation: false };
const DEFAULT_TEMPORARY_KIOSK_PIN = "0000";
const blankKioskPin = {
  pin: DEFAULT_TEMPORARY_KIOSK_PIN,
  confirmation: DEFAULT_TEMPORARY_KIOSK_PIN,
};

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

function userLocationIds(user, currentLocationId) {
  const assigned = user.locationIds || user.location_ids || [];
  return assigned.length ? assigned : currentLocationId ? [currentLocationId] : [];
}

function LocationSelector({ locations, value, onChange, requiredIds = [], disabled = false }) {
  function toggle(locationId) {
    if (requiredIds.includes(locationId)) return;
    onChange(value.includes(locationId)
      ? value.filter((id) => id !== locationId)
      : [...value, locationId]);
  }

  return (
    <fieldset className="admin-location-selector" disabled={disabled}>
      <legend>Locations</legend>
      <p>Select every location this user can access.</p>
      <div className="admin-location-options">
        {locations.map((location) => (
          <label key={location.id}>
            <input
              type="checkbox"
              checked={value.includes(location.id)}
              disabled={requiredIds.includes(location.id)}
              onChange={() => toggle(location.id)}
            />
            <span><strong>{location.name}</strong>{location.address ? <small>{location.address}</small> : null}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function LocationsHome({ locations, loading, onCreate, onOpen }) {
  return (
    <section className="admin-content">
      <PageHeader
        title="Locations"
        actions={<Button variant="primary" icon={Plus} onClick={onCreate}>New location</Button>}
      />
      <div className="admin-location-table">
        <div className="admin-table-head"><span>Location</span><span>Users</span><span>Open work</span><span>Template</span><span></span></div>
        {loading ? <div className="admin-empty">Loading locations</div> : locations.map((location) => (
          <button className="admin-location-row" type="button" key={location.id} onClick={() => onOpen(location.id)}>
            <span className="admin-location-name"><span className="admin-location-icon"><MarkerPin01 /></span><span><strong>{location.name}</strong><small>{location.address || location.type}</small></span></span>
            <span className="admin-location-stat"><small>Users</small><strong>{location.user_count}</strong></span>
            <span className="admin-location-stat"><small>Open work</small><strong>{location.open_workorder_count}</strong></span>
            <span className={`admin-location-stat ${location.has_template ? "admin-ready" : "admin-muted"}`}><small>Template</small><strong>{location.has_template ? "Ready" : "Missing"}</strong></span>
            <span className="admin-location-arrow" aria-hidden="true">›</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function OperationsHome({ actor, locations, draftQueue, onOpenWorkorder, onCreateWorkorder }) {
  return (
    <section className="admin-content admin-operations-content">
      <PageHeader
        title="Operations"
        actions={onCreateWorkorder ? <Button variant="primary" icon={Plus} onClick={onCreateWorkorder}>Create workorder</Button> : null}
      />
      <OperationsWorkspace actor={actor} locations={locations} {...draftQueue} onOpenWorkorder={onOpenWorkorder} />
    </section>
  );
}

function formatInviteExpiry(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function UserActionsMenu({ active, onManage, self, user }) {
  const passwordAction = user.role === "mechanic" ? "password" : "password-reset-email";
  const passwordLabel = user.role === "mechanic" ? "Set password" : "Send password reset";
  return (
    <MenuTrigger>
      <AriaButton
        className="admin-user-menu-trigger"
        aria-label={`Actions for ${user.name}`}
      >
        <DotsVertical />
      </AriaButton>
      <Popover className="admin-user-menu-popover" placement="bottom end">
        <Menu className="admin-user-menu" aria-label={`Actions for ${user.name}`}>
          <MenuItem
            className="admin-user-menu-item"
            onAction={() => onManage("locations", user)}
            textValue="Manage locations"
          >
            <MarkerPin01 />
            <span>{user.role === "admin" ? "View location access" : "Manage locations"}</span>
          </MenuItem>
          <MenuItem
            className="admin-user-menu-item"
            isDisabled={self}
            onAction={() => onManage(passwordAction, user)}
            textValue={passwordLabel}
          >
            {user.role === "mechanic" ? <Lock01 /> : <Mail01 />}
            <span>{passwordLabel}</span>
          </MenuItem>
          {user.role === "mechanic" ? (
            <MenuItem
              className="admin-user-menu-item"
              isDisabled={!active}
              onAction={() => onManage("kiosk-pin", user)}
              textValue={user.kiosk_pin_set ? "Reset kiosk PIN" : "Set kiosk PIN"}
            >
              <Passcode />
              <span>{user.kiosk_pin_set ? "Reset kiosk PIN" : "Set kiosk PIN"}</span>
            </MenuItem>
          ) : null}
          <MenuItem
            className="admin-user-menu-item"
            isDisabled={self}
            onAction={() => onManage(active ? "deactivate" : "activate", user)}
            textValue={active ? "Deactivate user" : "Activate user"}
          >
            {active ? <UserX01 /> : <UserCheck01 />}
            <span>{active ? "Deactivate user" : "Activate user"}</span>
          </MenuItem>
          <MenuItem
            className="admin-user-menu-item danger"
            isDisabled={self}
            onAction={() => onManage("delete", user)}
            textValue="Delete user"
          >
            <Trash01 />
            <span>Delete user</span>
          </MenuItem>
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

function UsersPanel({ actor, detail, onInvite, onManage, onResend, resendingId }) {
  const pendingInvitations = detail.invitations.filter((invite) => invite.status === "pending");
  return (
    <section className="admin-panel">
      <header className="admin-panel-header"><h2>Users</h2><Button variant="primary" icon={Mail01} onClick={onInvite}>Invite user</Button></header>
      <div className="admin-users-table">
        <div className="admin-users-head"><span>User</span><span>Role</span><span>Account</span><span>Kiosk PIN</span><span>Actions</span></div>
        {detail.users.length ? detail.users.map((user) => {
          const active = user.active && user.membership_active;
          const self = user.id === actor.id;
          const passwordAction = user.role === "mechanic" ? "password" : "password-reset-email";
          const passwordLabel = user.role === "mechanic" ? "Set password" : "Send password reset";
          return (
            <div className="admin-user-row" key={user.id}>
              <span>
                <strong>{user.name}{self ? " (you)" : ""}</strong>
                <small>{user.username ? `@${user.username}` : user.email}</small>
              </span>
              <span className="admin-role">{user.role}</span>
              <span><span className={`admin-user-status ${active ? "active" : "inactive"}`}>{active ? "Active" : "Inactive"}</span></span>
              <span className="admin-kiosk-pin-cell">
                {user.role === "mechanic" ? (
                  <span className={`admin-user-status ${user.kiosk_pin_set ? (user.kiosk_pin_requires_change ? "temporary" : "active") : "inactive"}`}>
                    {user.kiosk_pin_set ? (user.kiosk_pin_requires_change ? "Temporary" : "Set") : "Not set"}
                  </span>
                ) : <span className="admin-not-applicable">—</span>}
              </span>
              <span className="admin-user-actions admin-user-actions-desktop">
                <button type="button" title={`${user.role === "admin" ? "View" : "Manage"} locations for ${user.name}`} aria-label={`${user.role === "admin" ? "View" : "Manage"} locations for ${user.name}`} onClick={() => onManage("locations", user)}><MarkerPin01 /></button>
                <button type="button" title={self ? "Use your profile to change your own password" : `${passwordLabel} for ${user.name}`} aria-label={`${passwordLabel} for ${user.name}`} disabled={self} onClick={() => onManage(passwordAction, user)}>{user.role === "mechanic" ? <Lock01 /> : <Mail01 />}</button>
                {user.role === "mechanic" ? (
                  <button
                    type="button"
                    title={!active ? "Activate this mechanic before setting a kiosk PIN" : `${user.kiosk_pin_set ? "Reset" : "Set"} kiosk PIN for ${user.name}`}
                    aria-label={`${user.kiosk_pin_set ? "Reset" : "Set"} kiosk PIN for ${user.name}`}
                    disabled={!active}
                    onClick={() => onManage("kiosk-pin", user)}
                  >
                    <Passcode />
                  </button>
                ) : null}
                <button
                  type="button"
                  title={self ? "You cannot change your own status" : `${active ? "Deactivate" : "Activate"} ${user.name}`}
                  aria-label={`${active ? "Deactivate" : "Activate"} ${user.name}`}
                  disabled={self}
                  onClick={() => onManage(active ? "deactivate" : "activate", user)}
                >
                  {active ? <UserX01 /> : <UserCheck01 />}
                </button>
                <button type="button" className="danger" title={self ? "You cannot delete your own account" : `Delete ${user.name}`} aria-label={`Delete ${user.name}`} disabled={self} onClick={() => onManage("delete", user)}><Trash01 /></button>
              </span>
              <span className="admin-user-actions-mobile">
                <UserActionsMenu active={active} onManage={onManage} self={self} user={user} />
              </span>
            </div>
          );
        }) : <div className="admin-empty">No users assigned.</div>}
      </div>
      {pendingInvitations.length ? (
        <div className="admin-pending">
          <strong>Pending invitations</strong>
          <div className="admin-pending-list">
            {pendingInvitations.map((invite) => (
              <div className="admin-pending-row" key={invite.id}>
                <span>
                  <strong>{invite.email}</strong>
                  <small>{invite.role} · {invite.expired ? "Expired" : `Expires ${formatInviteExpiry(invite.expiresAt)}`}</small>
                </span>
                <Button
                  icon={Mail01}
                  onClick={() => onResend(invite)}
                  disabled={Boolean(resendingId)}
                >
                  {resendingId === invite.id ? "Resending" : "Resend link"}
                </Button>
              </div>
            ))}
          </div>
        </div>
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

function RulesPanel({ policy, onChange, onSave, saving }) {
  return (
    <section className="admin-panel admin-rules-panel">
      <div className="admin-panel-header">
        <div>
          <h2>Workorder rules</h2>
          <p>Control what mechanics can enter for work completed at this location.</p>
        </div>
        <Button variant="primary" onClick={onSave} disabled={saving}>
          {saving ? "Saving" : "Save rules"}
        </Button>
      </div>
      <label className="admin-rule-row">
        <span>
          <strong>Mechanics can record parts used</strong>
          <small>When off, mechanics can still request parts and message the office.</small>
        </span>
        <input
          type="checkbox"
          checked={policy.mechanicCanRecordParts}
          onChange={(event) => onChange(event.target.checked)}
        />
      </label>
    </section>
  );
}

function LocationDetail({ actor, detail, draftQueue, tab, setTab, template, setTemplate, policy, setPolicy, onBack, onInvite, onManageUser, onResendInvite, resendingInviteId, onSaveTemplate, onSavePolicy, saving, onOpenWorkorder }) {
  return (
    <section className="admin-content">
      <PageHeader
        title={detail.location.name}
        subtitle={detail.location.address || detail.location.type}
        leading={<button className="admin-back" type="button" onClick={onBack} aria-label="Back to locations"><ArrowLeft /></button>}
      />
      <nav className="admin-tabs" aria-label="Location settings">
        <button className={tab === "work" ? "active" : ""} type="button" onClick={() => setTab("work")}><Tool02 /> Work</button>
        <button className={tab === "users" ? "active" : ""} type="button" onClick={() => setTab("users")}><Users01 /> Users <span>{detail.users.length}</span></button>
        <button className={tab === "template" ? "active" : ""} type="button" onClick={() => setTab("template")}><File02 /> Template</button>
        <button className={tab === "rules" ? "active" : ""} type="button" onClick={() => setTab("rules")}><Settings01 /> Rules</button>
        <button className={tab === "kiosk" ? "active" : ""} type="button" onClick={() => setTab("kiosk")}><Key01 /> Kiosk</button>
      </nav>
      {tab === "work" ? <div className="admin-location-work"><OperationsWorkspace actor={actor} locations={[detail.location]} fixedLocationId={detail.location.id} {...draftQueue} onOpenWorkorder={onOpenWorkorder} /></div> : null}
      {tab === "users" ? <UsersPanel actor={actor} detail={detail} onInvite={onInvite} onManage={onManageUser} onResend={onResendInvite} resendingId={resendingInviteId} /> : null}
      {tab === "template" ? <TemplatePanel detail={detail} value={template} onChange={(key, value) => setTemplate((current) => ({ ...current, [key]: value }))} onSave={onSaveTemplate} saving={saving} /> : null}
      {tab === "rules" ? <RulesPanel policy={policy} onChange={(mechanicCanRecordParts) => setPolicy((current) => ({ ...current, mechanicCanRecordParts }))} onSave={onSavePolicy} saving={saving} /> : null}
      {tab === "kiosk" ? <KioskSettingsPanel locationId={detail.location.id} /> : null}
    </section>
  );
}

export function AdminWorkspace({
  actor,
  drafts = [],
  draftLoading = false,
  draftError = "",
  draftBusyId = "",
  onOpenWorkorder,
  onCreateWorkorder,
  onOpenDraft,
  onDiscardDraft,
  onTakeoverDraft,
  onRefreshDrafts,
}) {
  const [locations, setLocations] = useState([]);
  const [view, setView] = useState(() => initialAdminView(window.location.search));
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [tab, setTab] = useState("work");
  const [template, setTemplate] = useState(null);
  const [policy, setPolicy] = useState({ mechanicCanRecordParts: false });
  const [modal, setModal] = useState("");
  const [locationDraft, setLocationDraft] = useState(blankLocation);
  const [inviteDraft, setInviteDraft] = useState(blankInvite);
  const [inviteLocationIds, setInviteLocationIds] = useState([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteLinkRecipient, setInviteLinkRecipient] = useState("");
  const [resendingInviteId, setResendingInviteId] = useState("");
  const inviteCreateInFlight = useRef(false);
  const inviteResendInFlight = useRef(false);
  const [userAction, setUserAction] = useState(null);
  const [userLocationDraft, setUserLocationDraft] = useState([]);
  const [passwordDraft, setPasswordDraft] = useState(blankPassword);
  const [visiblePasswords, setVisiblePasswords] = useState(hiddenPasswords);
  const [kioskPinDraft, setKioskPinDraft] = useState(blankKioskPin);
  const [kioskPinError, setKioskPinError] = useState("");
  const [state, setState] = useState({ loading: true, busy: false, error: "", message: "" });
  const draftQueue = {
    drafts,
    draftLoading,
    draftError,
    draftBusyId,
    onOpenDraft,
    onDiscardDraft,
    onTakeoverDraft,
    onRefreshDrafts,
  };
  const selectedCompanyId = detail?.location?.company_id || detail?.location?.companyId || "";
  const companyLocations = selectedCompanyId
    ? locations.filter((location) => (location.company_id || location.companyId) === selectedCompanyId)
    : [];

  async function loadLocations() {
    const result = await api("/api/admin/locations");
    setLocations(result.locations || []);
    setState((current) => ({ ...current, loading: false, error: "" }));
  }
  async function openLocation(id, nextTab = "work") {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const result = await api(`/api/admin/locations/${id}`);
    setView("locations");
    setSelectedId(id);
    setDetail(result);
    setTemplate(templateForm(result.template, result.location));
    setPolicy(result.policy || { mechanicCanRecordParts: false });
    setTab(nextTab);
    setState((current) => ({ ...current, loading: false }));
    window.history.replaceState({}, "", `/?adminLocation=${encodeURIComponent(id)}`);
  }
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("adminLocation");
    loadLocations()
      .then(() => id ? openLocation(id) : null)
      .catch((error) => setState({ loading: false, busy: false, error: error.message, message: "" }));
  }, []);
  useAutomaticRefresh(
    () => loadLocations().catch((error) => setState((current) => ({ ...current, error: error.message }))),
  );

  function changeView(nextView) {
    setView(nextView);
    setSelectedId(null);
    setDetail(null);
    setTab("work");
    const query = nextView === "settings"
      ? "?adminView=settings&settingsTab=integrations"
      : `?adminView=${nextView}`;
    window.history.replaceState({}, "", `/${query}`);
  }

  function openMobileDestination(destination) {
    changeView(destination.view);
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
    if (inviteCreateInFlight.current) return;
    inviteCreateInFlight.current = true;
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const locationIds = [...new Set([selectedId, ...inviteLocationIds].filter(Boolean))];
      const result = await api(`/api/admin/locations/${selectedId}/invitations`, {
        method: "POST",
        body: JSON.stringify({ ...inviteDraft, locationIds }),
        timeoutMs: 15_000,
      });
      setInviteUrl(result.inviteUrl);
      setInviteLinkRecipient(result.invitation.email);
      setModal("inviteLink");
      setState((current) => ({ ...current, busy: false, message: "Invitation created." }));
      await openLocation(selectedId, "users");
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message }));
    } finally {
      inviteCreateInFlight.current = false;
    }
  }
  async function resendInvite(invite) {
    if (inviteResendInFlight.current) return;
    inviteResendInFlight.current = true;
    setResendingInviteId(invite.id);
    setState((current) => ({ ...current, error: "", message: "" }));
    try {
      const result = await api(`/api/admin/locations/${selectedId}/invitations/${invite.id}/resend`, {
        method: "POST",
        timeoutMs: 15_000,
      });
      setInviteUrl(result.inviteUrl);
      setInviteLinkRecipient(result.invitation.email);
      setDetail((current) => ({
        ...current,
        invitations: current.invitations.map((item) => item.id === result.invitation.id ? result.invitation : item),
      }));
      setModal("inviteLink");
      setState((current) => ({ ...current, message: "A new invitation link was created." }));
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally {
      setResendingInviteId("");
      inviteResendInFlight.current = false;
    }
  }
  async function copyInviteLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setState((current) => ({ ...current, error: "", message: "Invite link copied." }));
    } catch {
      setState((current) => ({ ...current, error: "The link could not be copied. Select and copy it manually." }));
    }
  }
  async function saveTemplate() {
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      await api(`/api/admin/locations/${selectedId}/template`, { method: "PUT", body: JSON.stringify(template) });
      setState((current) => ({ ...current, busy: false, message: "Template saved." }));
      await openLocation(selectedId, "template");
    } catch (error) { setState((current) => ({ ...current, busy: false, error: error.message })); }
  }

  async function savePolicy() {
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    try {
      const result = await api(`/api/admin/locations/${selectedId}/workorder-policy`, {
        method: "PATCH",
        body: JSON.stringify({
          mechanicCanRecordParts: policy.mechanicCanRecordParts,
        }),
      });
      setPolicy(result.policy);
      setDetail((current) => ({ ...current, policy: result.policy }));
      setState((current) => ({
        ...current,
        busy: false,
        message: "Workorder rules saved.",
      }));
    } catch (error) {
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  function openUserAction(type, user) {
    setPasswordDraft(blankPassword);
    setVisiblePasswords(hiddenPasswords);
    setKioskPinDraft(blankKioskPin);
    setKioskPinError("");
    setUserLocationDraft(userLocationIds(user, selectedId));
    setUserAction({ type, user });
    setState((current) => ({ ...current, error: "", message: "" }));
  }

  async function submitUserAction(event) {
    event.preventDefault();
    if (!userAction) return;
    if (userAction.type === "locations" && userAction.user.role !== "admin" && !userLocationDraft.length) {
      setState((current) => ({ ...current, error: "Select at least one location." }));
      return;
    }
    if (userAction.type === "password") {
      if (passwordDraft.password.length < 12) {
        setState((current) => ({ ...current, error: "Password must be at least 12 characters." }));
        return;
      }
      if (!passwordDraft.confirmation) {
        setState((current) => ({ ...current, error: "Confirm the new password." }));
        return;
      }
      if (passwordDraft.password !== passwordDraft.confirmation) {
        setState((current) => ({ ...current, error: "Passwords do not match." }));
        return;
      }
    }
    if (userAction.type === "kiosk-pin") {
      if (!isCompleteKioskPin(kioskPinDraft.pin)) {
        setKioskPinError("Use at least 4 digits.");
        return;
      }
      if (kioskPinDraft.pin !== kioskPinDraft.confirmation) {
        setKioskPinError("PINs do not match.");
        return;
      }
    }
    setState((current) => ({ ...current, busy: true, error: "", message: "" }));
    const base = `/api/admin/locations/${selectedId}/users/${userAction.user.id}`;
    try {
      if (userAction.type === "locations") {
        await api(`/api/admin/users/${userAction.user.id}/locations`, {
          method: "PUT",
          body: JSON.stringify({ companyId: selectedCompanyId, locationIds: userLocationDraft }),
        });
      } else if (userAction.type === "password-reset-email") {
        await api(`/api/admin/users/${userAction.user.id}/password-reset-email`, {
          method: "POST",
          body: JSON.stringify({ companyId: selectedCompanyId }),
          timeoutMs: 15_000,
        });
      } else if (userAction.type === "password") {
        await api(`${base}/password`, {
          method: "POST",
          body: JSON.stringify({ password: passwordDraft.password }),
          timeoutMs: 15_000,
        });
      } else if (userAction.type === "kiosk-pin") {
        await api(`${base}/kiosk-pin`, {
          method: "POST",
          body: JSON.stringify({ pin: kioskPinDraft.pin }),
        });
      } else if (userAction.type === "delete") {
        await api(base, { method: "DELETE" });
      } else {
        await api(`${base}/status`, {
          method: "PATCH",
          body: JSON.stringify({ active: userAction.type === "activate" }),
        });
      }
      const message = userAction.type === "locations"
        ? `Location access updated for ${userAction.user.name}.`
        : userAction.type === "password-reset-email"
        ? `Password reset email sent to ${userAction.user.name}.`
        : userAction.type === "password"
          ? `Password set for ${userAction.user.name}. Existing sessions were signed out.`
        : userAction.type === "kiosk-pin"
          ? `Temporary kiosk PIN ${userAction.user.kiosk_pin_set ? "reset" : "set"} for ${userAction.user.name}.`
        : userAction.type === "delete"
          ? `${userAction.user.name} was deleted.`
          : `${userAction.user.name} is now ${userAction.type === "activate" ? "active" : "inactive"}.`;
      setUserAction(null);
      setPasswordDraft(blankPassword);
      setKioskPinDraft(blankKioskPin);
      setState((current) => ({ ...current, busy: false, error: "", message }));
      if (!["password", "password-reset-email"].includes(userAction.type)) {
        await openLocation(selectedId, "users");
        await loadLocations();
      }
    } catch (error) {
      if (userAction.type === "kiosk-pin") {
        const fieldError = kioskPinFieldError(error);
        if (fieldError) {
          setKioskPinError(fieldError);
          setState((current) => ({ ...current, busy: false, error: "" }));
          return;
        }
      }
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  return (
    <main className="admin-shell">
      <style>{workorderTemplateStyles}</style>
      <WorkspaceHeader actor={actor} className="admin-workspace-header">
        <nav className="admin-primary-nav" aria-label="Admin workspace">
          <button className={view === "operations" ? "active" : ""} type="button" onClick={() => changeView("operations")}><Tool02 />Operations</button>
          <button className={view === "locations" ? "active" : ""} type="button" onClick={() => changeView("locations")}><MarkerPin01 />Locations</button>
          <button className={view === "settings" ? "active" : ""} type="button" onClick={() => changeView("settings")}><Settings01 />Settings</button>
        </nav>
      </WorkspaceHeader>
      {state.error ? <p className="admin-error" role="alert">{state.error}</p> : null}
      {state.message ? <p className="admin-success" role="status">{state.message}</p> : null}
      {view === "operations" ? <OperationsHome actor={actor} locations={locations} draftQueue={draftQueue} onOpenWorkorder={onOpenWorkorder} onCreateWorkorder={onCreateWorkorder} /> : null}
      {view === "settings" ? <IntegrationsSettings /> : null}
      {view === "locations" && selectedId && detail ? <LocationDetail actor={actor} detail={detail} draftQueue={draftQueue} tab={tab} setTab={setTab} template={template} setTemplate={setTemplate} policy={policy} setPolicy={setPolicy} onBack={() => { setSelectedId(null); setDetail(null); window.history.replaceState({}, "", "/?adminView=locations"); loadLocations(); }} onInvite={() => { setInviteDraft(blankInvite); setInviteLocationIds(selectedId ? [selectedId] : []); setInviteUrl(""); setInviteLinkRecipient(""); setState((current) => ({ ...current, error: "" })); setModal("invite"); }} onManageUser={openUserAction} onResendInvite={resendInvite} resendingInviteId={resendingInviteId} onSaveTemplate={saveTemplate} onSavePolicy={savePolicy} saving={state.busy} onOpenWorkorder={onOpenWorkorder} /> : null}
      {view === "locations" && !(selectedId && detail) ? <LocationsHome locations={locations} loading={state.loading} onCreate={() => setModal("location")} onOpen={(id) => openLocation(id).catch((error) => setState((current) => ({ ...current, error: error.message })))} /> : null}
      {modal === "location" ? <Modal title="New location" onClose={() => setModal("")}><form className="admin-modal-form" onSubmit={createLocation}><label><span>Name</span><input required value={locationDraft.name} onChange={(event) => setLocationDraft((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Type</span><select value={locationDraft.type} onChange={(event) => setLocationDraft((current) => ({ ...current, type: event.target.value }))}><option value="yard">Yard</option><option value="shop">Shop</option><option value="office">Office</option></select></label><label><span>Address</span><input value={locationDraft.address} onChange={(event) => setLocationDraft((current) => ({ ...current, address: event.target.value }))} /></label><Button variant="primary" type="submit" disabled={state.busy}>Create location</Button></form></Modal> : null}
      {modal === "invite" ? <Modal title="Invite user" onClose={() => setModal("")}><form className="admin-modal-form" onSubmit={createInvite}>{state.error ? <p className="admin-modal-error" role="alert">{state.error}</p> : null}<label><span>Name</span><input required value={inviteDraft.name} onChange={(event) => setInviteDraft((current) => ({ ...current, name: event.target.value }))} /></label><label><span>Email</span><input required type="email" value={inviteDraft.email} onChange={(event) => setInviteDraft((current) => ({ ...current, email: event.target.value }))} /></label><label><span>Role</span><select value={inviteDraft.role} onChange={(event) => setInviteDraft((current) => ({ ...current, role: event.target.value }))}><option value="mechanic">Mechanic</option><option value="office">Office</option><option value="surveillance">Surveillance</option><option value="admin">Admin</option></select></label>{inviteDraft.role === "admin" ? <div className="admin-inherited-access"><strong>All locations</strong><p>Admins automatically inherit access to every current and future location in this company.</p></div> : <LocationSelector locations={companyLocations} value={inviteLocationIds} onChange={setInviteLocationIds} requiredIds={selectedId ? [selectedId] : []} />}<Button variant="primary" type="submit" disabled={state.busy || (inviteDraft.role !== "admin" && !inviteLocationIds.length)}>{state.busy ? "Creating" : "Create invite"}</Button></form></Modal> : null}
      {modal === "inviteLink" ? <Modal title="Invite link" onClose={() => setModal("")}><div className="admin-invite-result"><p>Share this new link with <strong>{inviteLinkRecipient}</strong>. Any previous link for this invitation no longer works.</p><code>{inviteUrl}</code><Button icon={Copy01} onClick={copyInviteLink}>Copy link</Button></div></Modal> : null}
      {userAction ? (
        <Modal
          title={userAction.type === "locations" ? "Location access" : userAction.type === "password" ? "Set mechanic password" : userAction.type === "password-reset-email" ? "Send password reset" : userAction.type === "kiosk-pin" ? `${userAction.user.kiosk_pin_set ? "Reset" : "Set"} kiosk PIN` : userAction.type === "delete" ? "Delete user" : `${userAction.type === "activate" ? "Activate" : "Deactivate"} user`}
          onClose={() => !state.busy && setUserAction(null)}
        >
          <form className="admin-modal-form" onSubmit={submitUserAction}>
            {state.error ? <p className="admin-modal-error" role="alert">{state.error}</p> : null}
            {userAction.type === "locations" ? (
              userAction.user.role === "admin" ? (
                <div className="admin-inherited-access">
                  <strong>All locations</strong>
                  <p>Admins automatically inherit access to every current and future location.</p>
                  <Button type="button" onClick={() => setUserAction(null)}>Done</Button>
                </div>
              ) : (
                <>
                  <p className="admin-modal-copy">Choose the locations <strong>{userAction.user.name}</strong> can access. Their company role remains unchanged.</p>
                  <LocationSelector locations={companyLocations} value={userLocationDraft} onChange={setUserLocationDraft} />
                  <Button variant="primary" type="submit" disabled={state.busy || !userLocationDraft.length}>{state.busy ? "Saving" : "Save location access"}</Button>
                </>
              )
            ) : userAction.type === "password" ? (
              <>
                <p className="admin-modal-copy">Set a new password for <strong>{userAction.user.name}</strong>. No email is required. Their current sessions will be signed out.</p>
                <div className="password-field-group admin-password-field-group">
                  <label htmlFor="admin-new-password"><span>New password</span></label>
                  <div className="password-input-control">
                    <input id="admin-new-password" required autoFocus type={visiblePasswords.password ? "text" : "password"} minLength="12" maxLength="128" autoComplete="new-password" aria-invalid={passwordDraft.password.length > 0 && passwordDraft.password.length < 12} value={passwordDraft.password} onChange={(event) => { setPasswordDraft((current) => ({ ...current, password: event.target.value })); setState((current) => ({ ...current, error: "" })); }} />
                    <PasswordVisibilityToggle visible={visiblePasswords.password} controls="admin-new-password" onToggle={() => setVisiblePasswords((current) => ({ ...current, password: !current.password }))} />
                  </div>
                </div>
                <div className="password-field-group admin-password-field-group">
                  <label htmlFor="admin-confirm-password"><span>Confirm password</span></label>
                  <div className="password-input-control">
                    <input id="admin-confirm-password" required type={visiblePasswords.confirmation ? "text" : "password"} minLength="12" maxLength="128" autoComplete="new-password" aria-invalid={passwordDraft.confirmation.length > 0 && passwordDraft.password !== passwordDraft.confirmation} value={passwordDraft.confirmation} onChange={(event) => { setPasswordDraft((current) => ({ ...current, confirmation: event.target.value })); setState((current) => ({ ...current, error: "" })); }} />
                    <PasswordVisibilityToggle visible={visiblePasswords.confirmation} controls="admin-confirm-password" onToggle={() => setVisiblePasswords((current) => ({ ...current, confirmation: !current.confirmation }))} />
                  </div>
                </div>
                <div className="admin-password-rules" aria-live="polite">
                  <span className={passwordDraft.password.length >= 12 ? "valid" : ""}>At least 12 characters</span>
                  <span className={passwordDraft.confirmation && passwordDraft.password === passwordDraft.confirmation ? "valid" : passwordDraft.confirmation ? "invalid" : ""}>Passwords match</span>
                </div>
                <Button variant="primary" icon={Lock01} type="submit" disabled={state.busy || passwordDraft.password.length < 12 || passwordDraft.password !== passwordDraft.confirmation}>{state.busy ? "Setting" : "Set password"}</Button>
              </>
            ) : userAction.type === "password-reset-email" ? (
              <>
                <p className="admin-modal-copy">Send a secure, one-use password reset link to <strong>{userAction.user.login_email || userAction.user.email}</strong>. The link expires after 15 minutes.</p>
                <Button variant="primary" icon={Mail01} type="submit" disabled={state.busy}>{state.busy ? "Sending" : "Send reset email"}</Button>
              </>
            ) : userAction.type === "kiosk-pin" ? (
              <>
                <p className="admin-modal-copy">Set a temporary kiosk PIN for <strong>{userAction.user.name}</strong>. They must replace it after their first kiosk unlock.</p>
                <label htmlFor="admin-kiosk-pin">
                  <span>Temporary PIN</span>
                  <input
                    id="admin-kiosk-pin"
                    autoFocus
                    autoComplete="new-password"
                    inputMode="numeric"
                    minLength="4"
                    pattern="[0-9]{4,}"
                    type="password"
                    aria-describedby={kioskPinError ? "admin-kiosk-pin-error" : undefined}
                    aria-invalid={Boolean(kioskPinError)}
                    value={kioskPinDraft.pin}
                    onChange={(event) => {
                      setKioskPinDraft((current) => ({ ...current, pin: kioskPinValue(event.target.value) }));
                      setKioskPinError("");
                    }}
                    required
                  />
                </label>
                <label htmlFor="admin-kiosk-pin-confirmation">
                  <span>Confirm PIN</span>
                  <input
                    id="admin-kiosk-pin-confirmation"
                    autoComplete="new-password"
                    inputMode="numeric"
                    minLength="4"
                    pattern="[0-9]{4,}"
                    type="password"
                    value={kioskPinDraft.confirmation}
                    onChange={(event) => {
                      setKioskPinDraft((current) => ({ ...current, confirmation: kioskPinValue(event.target.value) }));
                      setKioskPinError("");
                    }}
                    required
                  />
                </label>
                {kioskPinError ? <small className="admin-kiosk-pin-error" id="admin-kiosk-pin-error" role="alert">{kioskPinError}</small> : null}
                <Button variant="primary" icon={Passcode} type="submit" disabled={state.busy || !isCompleteKioskPin(kioskPinDraft.pin) || kioskPinDraft.pin !== kioskPinDraft.confirmation}>{state.busy ? "Saving" : `${userAction.user.kiosk_pin_set ? "Reset" : "Set"} temporary PIN`}</Button>
              </>
            ) : userAction.type === "delete" ? (
              <>
                <p className="admin-modal-copy">Delete <strong>{userAction.user.name}</strong>? Their login will be removed and their historical work records will remain under “Deleted user.” This cannot be undone.</p>
                <Button variant="danger" icon={Trash01} type="submit" disabled={state.busy}>{state.busy ? "Deleting" : "Delete user"}</Button>
              </>
            ) : (
              <>
                <p className="admin-modal-copy">{userAction.type === "activate" ? "Restore login and location access" : "Sign out and block access"} for <strong>{userAction.user.name}</strong>?</p>
                <Button variant={userAction.type === "activate" ? "primary" : "danger"} icon={userAction.type === "activate" ? UserCheck01 : UserX01} type="submit" disabled={state.busy}>{state.busy ? "Saving" : userAction.type === "activate" ? "Activate user" : "Deactivate user"}</Button>
              </>
            )}
          </form>
        </Modal>
      ) : null}
      <nav className="admin-mobile-nav" aria-label="Admin workspace">
        {ADMIN_MOBILE_DESTINATIONS.map((destination) => {
          const Icon = destination.key === "locations"
            ? MarkerPin01
            : destination.key === "users"
              ? Users01
              : destination.key === "template"
                ? File02
                : destination.key === "settings"
                  ? Settings01
                  : Tool02;
          const active = adminMobileDestinationState({ view, tab, selectedId }, destination);
          return (
            <button
              className={`${active ? "active" : ""}${destination.secondary ? " secondary" : ""}`}
              key={destination.key}
              type="button"
              onClick={() => openMobileDestination(destination)}
            >
              <Icon />
              <span>{destination.label}</span>
            </button>
          );
        })}
        <ProfileMenu actor={actor} mobileNav />
      </nav>
    </main>
  );
}

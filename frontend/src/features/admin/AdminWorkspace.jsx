import { useEffect, useRef, useState } from "react";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { api } from "../../lib/api.js";
import { isCompleteKioskPin } from "../kiosk/kiosk-utils.js";
import { normalizeModuleAccessMap, normalizeUserModuleAccessMap } from "../../../../shared/workorder-modules.js";
import { kioskPinFieldError } from "./kiosk-admin-errors.js";
import { useAdminModulesController } from "./modules/useAdminModulesController.js";
import { canonicalAdminSearch, initialAdminView } from "./adminNavigation.js";
import { AdminLocationDialogs } from "./workspace/AdminLocationDialogs.jsx";
import { AdminUserActionDialog } from "./workspace/AdminUserActionDialog.jsx";
import { AdminWorkspaceShell } from "./workspace/AdminWorkspaceShell.jsx";
import {
  BLANK_INVITE, BLANK_KIOSK_PIN, BLANK_LOCATION, BLANK_PASSWORD,
  HIDDEN_PASSWORDS, templateForm, userLocationIds,
} from "./workspace/admin-workspace-model.js";
import "./admin.css";
export function AdminWorkspace({
  actor,
  drafts = [], draftLoading = false,
  draftError = "",
  draftBusyId = "",
  onOpenWorkorder, onCreateWorkorder,
  inspectionAccess = { canRead: false, canWrite: false }, workorderAccess = { canRead: true, canWrite: true },
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
  const [policy, setPolicy] = useState({
    mechanicCanRecordParts: false,
    moduleAccess: normalizeModuleAccessMap(),
    userModuleAccess: normalizeUserModuleAccessMap(),
  });
  const [modal, setModal] = useState("");
  const [locationDraft, setLocationDraft] = useState(BLANK_LOCATION);
  const [inviteDraft, setInviteDraft] = useState(BLANK_INVITE);
  const [inviteLocationIds, setInviteLocationIds] = useState([]);
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteLinkRecipient, setInviteLinkRecipient] = useState("");
  const [inviteDelivery, setInviteDelivery] = useState(null);
  const [resendingInviteId, setResendingInviteId] = useState("");
  const inviteCreateInFlight = useRef(false);
  const inviteResendInFlight = useRef(false);
  const [userAction, setUserAction] = useState(null);
  const [userLocationDraft, setUserLocationDraft] = useState([]);
  const [passwordDraft, setPasswordDraft] = useState(BLANK_PASSWORD);
  const [visiblePasswords, setVisiblePasswords] = useState(HIDDEN_PASSWORDS);
  const [kioskPinDraft, setKioskPinDraft] = useState(BLANK_KIOSK_PIN);
  const [kioskPinError, setKioskPinError] = useState("");
  const [state, setState] = useState({ loading: true, busy: false, error: "", message: "" });
  const modulesController = useAdminModulesController({ setDetail, setSelectedId, setState, setView });
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
    const nextLocations = result.locations || [];
    setLocations(nextLocations);
    setState((current) => ({ ...current, loading: false, error: "" }));
    return nextLocations;
  }
  async function openLocation(id, nextTab = "work", nextView = "locations") {
    setState((current) => ({ ...current, loading: true, error: "" }));
    const result = await api(`/api/admin/locations/${id}`);
    setView(nextView);
    setSelectedId(id);
    setDetail(result);
    setTemplate(templateForm(result.template, result.location));
    setPolicy(result.policy || {
      mechanicCanRecordParts: false,
      moduleAccess: normalizeModuleAccessMap(),
      userModuleAccess: normalizeUserModuleAccessMap(),
    });
    await modulesController.activateLocation(result.location, nextView);
    setTab(nextTab);
    setState((current) => ({ ...current, loading: false }));
    const viewQuery = nextView === "modules" ? "adminView=modules&" : "";
    window.history.replaceState({}, "", `/?${viewQuery}adminLocation=${encodeURIComponent(id)}`);
  }
  useEffect(() => {
    const originalSearch = window.location.search;
    const canonicalSearch = canonicalAdminSearch(originalSearch);
    if (canonicalSearch !== originalSearch) window.history.replaceState({}, "", `/${canonicalSearch}`);
    const initialView = initialAdminView(canonicalSearch);
    modulesController.initialize({ initialView, loadLocations, openLocation, search: canonicalSearch })
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
    if (nextView === "modules") modulesController.setScopeType("");
    const query = nextView === "settings"
      ? "?adminView=settings&settingsTab=integrations"
      : `?adminView=${nextView}`;
    window.history.replaceState({}, "", `/${query}`);
  }

  async function createLocation(event) {
    event.preventDefault();
    setState((current) => ({ ...current, busy: true, error: "" }));
    try {
      const result = await api("/api/admin/locations", { method: "POST", body: JSON.stringify(locationDraft) });
      setModal(""); setLocationDraft(BLANK_LOCATION); await loadLocations(); await openLocation(result.location.id);
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
        timeoutMs: 30_000,
      });
      setInviteUrl(result.inviteUrl);
      setInviteLinkRecipient(result.invitation.email);
      setInviteDelivery(result.delivery || { status: "failed" });
      setModal("inviteLink");
      setState((current) => ({
        ...current,
        busy: false,
        message: result.delivery?.status === "sent"
          ? "Invitation email sent."
          : "Invitation created. Use the backup link to share it.",
      }));
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
        timeoutMs: 30_000,
      });
      setInviteUrl(result.inviteUrl);
      setInviteLinkRecipient(result.invitation.email);
      setInviteDelivery(result.delivery || { status: "failed" });
      setDetail((current) => ({
        ...current,
        invitations: current.invitations.map((item) => item.id === result.invitation.id ? result.invitation : item),
      }));
      setModal("inviteLink");
      setState((current) => ({
        ...current,
        message: result.delivery?.status === "sent"
          ? "A new invitation email was sent."
          : "A new invitation was created. Use the backup link to share it.",
      }));
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
          moduleAccess: policy.moduleAccess,
          userModuleAccess: policy.userModuleAccess,
          expectedVersion: policy.version,
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
      if (error.status === 409 || error.code === "WORKORDER_MODULE_POLICY_CONFLICT") {
        await openLocation(selectedId, "rules");
        setState((current) => ({
          ...current,
          busy: false,
          error: "Workorder rules changed elsewhere. The latest settings were loaded; review them and try again.",
        }));
        return;
      }
      setState((current) => ({ ...current, busy: false, error: error.message }));
    }
  }

  function openUserAction(type, user) {
    if (type === "modules") {
      openLocation(selectedId, "work", "modules")
        .catch((error) => setState((current) => ({ ...current, error: error.message })));
      return;
    }
    setPasswordDraft(BLANK_PASSWORD);
    setVisiblePasswords(HIDDEN_PASSWORDS);
    setKioskPinDraft(BLANK_KIOSK_PIN);
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
        await api(`${base}/password-reset-email`, {
          method: "POST",
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
        : userAction.type === "modules"
          ? `Module access saved for ${userAction.user.name}.`
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
      setPasswordDraft(BLANK_PASSWORD);
      setKioskPinDraft(BLANK_KIOSK_PIN);
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

  const locationDetailProps = {
    actor,
    detail,
    draftQueue,
    tab,
    setTab,
    template,
    setTemplate,
    policy,
    setPolicy,
    onBack: () => {
      setSelectedId(null);
      setDetail(null);
      window.history.replaceState({}, "", "/?adminView=locations");
      loadLocations();
    },
    onInvite: () => {
      setInviteDraft(BLANK_INVITE);
      setInviteLocationIds(selectedId ? [selectedId] : []);
      setInviteUrl("");
      setInviteLinkRecipient("");
      setInviteDelivery(null);
      setState((currentState) => ({ ...currentState, error: "" }));
      setModal("invite");
    },
    onManageUser: openUserAction,
    onResendInvite: resendInvite,
    resendingInviteId,
    onSaveTemplate: saveTemplate,
    onSavePolicy: savePolicy,
    onOpenModules: () => openLocation(selectedId, "work", "modules"),
    saving: state.busy,
    onOpenWorkorder,
  };

  const modulePageProps = modulesController.pageProps({ detail, locations, openLocation, policy, saving: state.busy, selectedId, setPolicy });

  return (
    <>
      <AdminWorkspaceShell
        actor={actor}
        view={view}
        changeView={changeView}
        state={state}
        locations={locations}
        draftQueue={draftQueue}
        onOpenWorkorder={onOpenWorkorder}
      onCreateWorkorder={onCreateWorkorder}
      inspectionAccess={inspectionAccess}
      workorderAccess={workorderAccess}
        selectedId={selectedId}
        detail={detail}
        locationDetailProps={locationDetailProps}
        onCreateLocation={() => setModal("location")}
        onOpenLocation={(id) => openLocation(id).catch((error) => setState((currentState) => ({ ...currentState, error: error.message })))}
        modulePageProps={modulePageProps}
      />
      <AdminLocationDialogs
        modal={modal}
        setModal={setModal}
        busy={state.busy}
        error={state.error}
        locationDraft={locationDraft}
        setLocationDraft={setLocationDraft}
        onCreateLocation={createLocation}
        inviteDraft={inviteDraft}
        setInviteDraft={setInviteDraft}
        companyLocations={companyLocations}
        inviteLocationIds={inviteLocationIds}
        setInviteLocationIds={setInviteLocationIds}
        selectedId={selectedId}
        onCreateInvite={createInvite}
        inviteDelivery={inviteDelivery}
        inviteLinkRecipient={inviteLinkRecipient}
        inviteUrl={inviteUrl}
        onCopyInviteLink={copyInviteLink}
      />
      <AdminUserActionDialog
        userAction={userAction}
        onClose={() => setUserAction(null)}
        onSubmit={submitUserAction}
        busy={state.busy}
        error={state.error}
        companyLocations={companyLocations}
        userLocationDraft={userLocationDraft}
        setUserLocationDraft={setUserLocationDraft}
        passwordDraft={passwordDraft}
        setPasswordDraft={setPasswordDraft}
        visiblePasswords={visiblePasswords} setVisiblePasswords={setVisiblePasswords}
        kioskPinDraft={kioskPinDraft}
        setKioskPinDraft={setKioskPinDraft}
        kioskPinError={kioskPinError} setKioskPinError={setKioskPinError}
        clearError={() => setState((currentState) => ({ ...currentState, error: "" }))}
      />
    </>
  );
}

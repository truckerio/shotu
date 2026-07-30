import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw01 } from "@untitledui/icons";
import {
  useDraftForm,
  useUnsavedBrowserGuard,
} from "../../components/drafts/index.js";
import {
  createWorkorderSearch,
  currentRouteParams,
  defaultWorkspaceForRole,
  draftsSearch,
  readInitialWorkspace,
  replaceRouteSearch,
  routeStartsLoading,
  workorderDetailSearch,
} from "./route-state.js";
import { getVehicleLocation } from "../../components/workorders/AssetLocationCard.jsx";
import { MechanicWorkspace } from "../../features/mechanic/MechanicWorkspace.jsx";
import { useMechanicProgress } from "../../features/mechanic/progress/useMechanicProgress.js";
import { resolveMechanicProgressFields } from "../../features/mechanic/progress/mechanic-progress-fields.js";
import { purgeMechanicWorkStorage } from "../../features/mechanic/progress/mechanic-work-storage.js";
import { OfficeWorkspace } from "../../features/office/OfficeWorkspace.jsx";
import { SurveillanceWorkspace } from "../../features/surveillance/SurveillanceWorkspace.jsx";
import { CreateWorkorderPage } from "../../features/create-workorder/CreateWorkorderPage.jsx";
import { WorkorderDetailPage } from "../../features/workorder-detail/WorkorderDetailPage.jsx";
import {
  buildWorkorderDetailSections,
  defaultDetailSection,
  defaultSupportingView,
} from "../../features/workorder-detail/workorder-detail-sections.js";
import { useWorkorderDetailRealtime } from "../../features/workorder-detail/useWorkorderDetailRealtime.js";
import { canonicalApprovalName, canonicalPreviewTimes } from "../../features/workorder-detail/workorder-handoff.js";
import { canonicalDetailPreviewTemplate } from "../../features/workorder-detail/workorder-preview-template.js";
import {
  clearOfficeWorkorderEditBackup,
  readOfficeWorkorderEditBackup,
  writeOfficeWorkorderEditBackup,
} from "../../features/workorder-detail/office-workorder-autosave-storage.js";
import { validateCreateWorkorder } from "../../features/generator/create-workorder-validation.js";
import {
  createLocationDefaultPatch,
  createLocationTemplatePatch,
  splitSerial,
  templateFieldsForCreateLocation,
  todayIso,
  uniqueExactVehicleMatch,
  vehicleLookupValues,
  normalizeVehicleLookupValue,
  resolveCreateLocation,
} from "../../features/create-workorder/create-workorder-utils.js";
import {
  buildWorkorderDraftPayload,
  formValuesFromWorkorderDraft,
  isMeaningfulWorkorderDraft,
  selectedVehicleFromWorkorderDraft,
} from "../../features/generator/workorder-draft.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { api } from "../../lib/api.js";
import { visibleConversationMessages } from "../../components/workorders/chat-messages.js";
import { normalizeUsedParts } from "../../components/workorders/used-parts-model.js";
import { emptyPart, workorderPhysicalPageCount } from "../../../../shared/workorder-template.js";

const AdminWorkspace = lazy(() => import("../../features/admin/AdminWorkspace.jsx").then((module) => ({ default: module.AdminWorkspace })));

async function createWorkorderDraft(payload) {
  const result = await api("/api/workorder-drafts", {
    method: "POST",
    body: JSON.stringify({
      type: "workorder",
      locationId: payload.locationId || null,
      payload,
    }),
  });
  return result.draft;
}

async function updateWorkorderDraft(draftId, { version, payload }) {
  const result = await api(`/api/workorder-drafts/${encodeURIComponent(draftId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      version,
      locationId: payload.locationId || null,
      payload,
    }),
  });
  return result.draft;
}

async function discardWorkorderDraft(draftId) {
  return api(`/api/workorder-drafts/${encodeURIComponent(draftId)}`, { method: "DELETE" });
}

function workorderDraftOwnerId(draft) {
  return draft?.owner?.id || draft?.ownerId || draft?.createdBy?.id || draft?.creator?.id || "";
}

function createDraftBaselineFromForm(form) {
  return {
    locationId: form.locationId || "",
    workStartDate: form.workStartDate,
    workEndDate: form.workEndDate,
    formData: {
      headerTitle: form.headerTitle,
      brandTop: form.brandTop,
      brandBottom: form.brandBottom,
      warrantyText: form.warrantyText,
      responsibilityText: form.responsibilityText,
      authorizationText: form.authorizationText,
    },
  };
}

async function updateMechanicProgress({
  workorderId,
  diagnosis,
  workPerformed,
  expectedVersion,
  recordActivity,
}) {
  return api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/progress`, {
    method: "PATCH",
    body: JSON.stringify({
      diagnosis,
      workPerformed,
      expectedVersion,
      recordActivity,
    }),
  });
}

export function RoleRouter({ actor }) {
  const formRef = useRef(null);
  const previewRef = useRef(null);
  const previewGridRef = useRef(null);
  const detailLocationRefreshRef = useRef("");
  const locationRequestRef = useRef({ vehicleId: "", promise: null });
  const mechanicProgressBackupRestoredRef = useRef("");
  const officeAutosaveTimerRef = useRef(null);
  const officeAutosaveInFlightRef = useRef(false);
  const officeAutosaveQueuedRef = useRef(false);
  const officeAutosaveRevisionRef = useRef(0);
  const [workspace, setWorkspace] = useState(() => readInitialWorkspace(actor));
  const [mode, setMode] = useState(() => (actor.role === "mechanic" ? "mechanic" : "admin"));
  const [routeLoading, setRouteLoading] = useState(routeStartsLoading);
  const [activeWorkorder, setActiveWorkorder] = useState(null);
  const [mechanicAction, setMechanicAction] = useState({ busy: "", message: "" });
  const [mechanicFinish, setMechanicFinish] = useState({ open: false, name: "", message: "" });
  const [officeCloseOpen, setOfficeCloseOpen] = useState(false);
  const [officeCloseNote, setOfficeCloseNote] = useState("");
  const [officeReturn, setOfficeReturn] = useState({ open: false, reason: "", categories: [], message: "" });
  const [officeCancel, setOfficeCancel] = useState({ open: false, reason: "", message: "" });
  const [officeAssignment, setOfficeAssignment] = useState({ mechanicUserIds: [], reason: "" });
  const [createAssignment, setCreateAssignment] = useState({ mechanicUserIds: [], mechanics: [], loading: false });
  const [previewPanelOpen, setPreviewPanelOpen] = useState(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [isPhone, setIsPhone] = useState(() => (typeof window === "undefined" ? false : window.matchMedia("(max-width: 700px)").matches));
  const [isCompact, setIsCompact] = useState(() => (
    typeof window === "undefined"
      ? false
      : window.matchMedia("(max-width: 1180px)").matches
  ));
  const [detailSection, setDetailSection] = useState("work");
  const [supportingView, setSupportingView] = useState("preview");
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [printState, setPrintState] = useState({ open: false, stage: "idle", message: "" });
  const [browserPrintPayload, setBrowserPrintPayload] = useState(null);
  const [officeCreateState, setOfficeCreateState] = useState({ busy: false, message: "" });
  const [officeCreateErrors, setOfficeCreateErrors] = useState({});
  const [officeCreateAttempt, setOfficeCreateAttempt] = useState(0);
  const [resumedDraft, setResumedDraft] = useState(null);
  const [draftWorkspaceState, setDraftWorkspaceState] = useState({
    drafts: [],
    loading: false,
    error: "",
    busyId: "",
  });
  const [draftLeaveOpen, setDraftLeaveOpen] = useState(false);
  const [draftLeaveBusy, setDraftLeaveBusy] = useState(false);
  const createInitialDatesRef = useRef({
    locationId: actor.locationIds?.[0] || "",
    workStartDate: todayIso(),
    workEndDate: todayIso(),
    formData: {
      headerTitle: "CHINO YARD WORKORDER",
      brandTop: "PRO TEC",
      brandBottom: "REPAIR",
      warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
      responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
      authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
    },
  });
  const [officeDetailState, setOfficeDetailState] = useState({ busy: false, message: "" });
  const [officeAutosaveRevision, setOfficeAutosaveRevision] = useState(0);
  const [usedPartsDirty, setUsedPartsDirty] = useState(false);
  const [vehicleLookup, setVehicleLookup] = useState({ loading: false, status: "", results: [] });
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [officeLocations, setOfficeLocations] = useState([]);
  const [mapsConfig, setMapsConfig] = useState({});
  const [detailStatus, setDetailStatus] = useState("open");
  const [detailSource, setDetailSource] = useState(null);
  const [form, setForm] = useState({
    companyName: "",
    customerCompanyName: "",
    locationId: actor.locationIds?.[0] || "",
    locationName: "",
    headerTitle: "CHINO YARD WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
    responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
    authorizationText: "I authorize the above repair to be completed along with necessary material(s). I grant you and/or your employees permission to operate the vehicle described herein on street, highways, or elsewhere for the purpose of testing and/or inspection. An express mechanic's lien is hereby acknowledged on above vehicle to secure the amount of repairs thereto.",
    prefix: "WO-",
    nextNumber: 1,
    digits: 6,
    copies: 1,
    workDate: todayIso(),
    workStartDate: todayIso(),
    workEndDate: todayIso(),
    unitNo: "",
    unitType: "",
    licenseNo: "",
    mileage: "",
    model: "",
    vinNo: "",
    mechanicConcern: "",
    diagnosis: "",
    workPerformed: "",
    mechanicName: actor.role === "mechanic" ? actor.name || "" : "",
    startTime: "",
    endTime: "",
    managerName: "",
    officeNotes: "",
    customerSignature: "",
    authorizedBy: "",
    parts: [emptyPart(), emptyPart(), emptyPart()],
  });
  const createMechanicUserIds = useMemo(() => (
    actor.role === "mechanic"
      ? [actor.id].filter(Boolean)
      : createAssignment.mechanicUserIds
  ), [actor.id, actor.role, createAssignment.mechanicUserIds]);
  const createAssignmentForRole = useMemo(() => (
    actor.role === "mechanic"
      ? {
        loading: false,
        mechanicUserIds: createMechanicUserIds,
        mechanics: [{
          id: actor.id,
          name: actor.name || "You",
        }],
      }
      : createAssignment
  ), [actor.id, actor.name, actor.role, createAssignment, createMechanicUserIds]);
  const workorderDraftPayload = useMemo(() => buildWorkorderDraftPayload({
    actor,
    form,
    mechanicUserIds: createMechanicUserIds,
    selectedVehicle,
  }), [actor, createMechanicUserIds, form, selectedVehicle]);
  const workorderDraftMeaningful = (
    workspace === "generator"
    && !activeWorkorder
    && ["office", "admin"].includes(actor.role)
    && isMeaningfulWorkorderDraft(workorderDraftPayload, createInitialDatesRef.current)
  );
  const workorderDraft = useDraftForm({
    value: workorderDraftPayload,
    meaningful: workorderDraftMeaningful,
    draft: resumedDraft,
    createDraft: createWorkorderDraft,
    updateDraft: updateWorkorderDraft,
    discardDraft: discardWorkorderDraft,
  });
  useUnsavedBrowserGuard({
    enabled: workspace === "generator" && !activeWorkorder,
    hasUnsyncedChanges: workorderDraft.hasUnsyncedChanges,
    flush: workorderDraft.flush,
    onFlushError: (error) => {
      setOfficeCreateState({ busy: false, message: error.message });
    },
  });

  const effectiveCopies = 1;
  const firstSerial = activeWorkorder?.workorder?.serial || "DRAFT";
  const lastSerial = firstSerial;
  const range = firstSerial;
  const previewSerials = useMemo(() => [firstSerial], [firstSerial]);
  const workorderCountLabel = activeWorkorder ? "1 workorder" : "Draft workorder";
  const lastPhysicalPageIndex = workorderPhysicalPageCount(form) - 1;
  const primaryActionLabel = "Print workorder";
  const canPrint = actor.role === "office" || actor.role === "admin";
  const statusOptions = [
    { value: "open", label: "Open" },
    { value: "accepted", label: "Accepted" },
    { value: "in_progress", label: "Working" },
    { value: "waiting_office", label: "Need office" },
    { value: "parts_requested", label: "Parts requested" },
    { value: "mechanic_done", label: "Work done" },
    { value: "closed", label: "Closed" },
    { value: "odoo_entered", label: "Odoo entered" },
    { value: "cancelled", label: "Cancelled" },
  ];
  const currentStatusLabel = statusOptions.find((option) => option.value === detailStatus)?.label || "Open";
  const isMechanicDetail = detailSource === "mechanic" && Boolean(activeWorkorder);
  const isOfficeDetail = detailSource === "office" && Boolean(activeWorkorder);
  const isWorkorderDetail = Boolean(activeWorkorder);
  const showEmbeddedPreview = previewPanelOpen && (!isWorkorderDetail || !isCompact);
  const conversationMessages = useMemo(() => {
    if (!activeWorkorder) return [];
    const officeNote = activeWorkorder.workorder.officeNotes
      ? [{
        id: "office-note",
        senderRole: "office",
        senderName: "Office",
        messageType: "normal",
        body: activeWorkorder.workorder.officeNotes,
        createdAt: null,
      }]
      : [];
    return visibleConversationMessages([...officeNote, ...(activeWorkorder.messages || [])]);
  }, [activeWorkorder]);
  const filledPartCount = form.parts.filter((part) => part.partNo || part.qty || part.repairOrder).length;
  const mechanicAsset = activeWorkorder?.workorder?.asset || {};
  const mechanicUnitType = form.unitType || mechanicAsset.unitType || "Vehicle";
  const mechanicVehicleLabel = [
    mechanicAsset.year,
    mechanicAsset.make,
    mechanicAsset.model,
  ].filter(Boolean).join(" ") || form.model || "Not listed";
  const mechanicMapVehicle = selectedVehicle || mechanicAsset;
  const mechanicMapLocation = getVehicleLocation(mechanicMapVehicle);
  const mechanicProgress = useMechanicProgress({
    actorId: actor.id,
    workorderId: isMechanicDetail ? activeWorkorder?.workorder?.id : null,
    value: {
      diagnosis: form.diagnosis,
      workPerformed: form.workPerformed,
    },
    initialVersion: activeWorkorder?.workorder?.progressVersion || 1,
    saveProgress: updateMechanicProgress,
  });
  useEffect(() => () => {
    if (actor.role === "mechanic") purgeMechanicWorkStorage();
  }, [actor.id, actor.role]);
  useEffect(() => {
    const workorderId = activeWorkorder?.workorder?.id;
    const backup = mechanicProgress.backup;
    if (
      !isMechanicDetail
      || !activeWorkorder?.allowedActions?.saveNotes
      || !workorderId
      || !backup
      || mechanicProgressBackupRestoredRef.current === workorderId
    ) return;
    mechanicProgressBackupRestoredRef.current = workorderId;
    if (backup.diagnosis === form.diagnosis && backup.workPerformed === form.workPerformed) return;
    setForm((current) => ({
      ...current,
      diagnosis: backup.diagnosis,
      workPerformed: backup.workPerformed,
    }));
    setMechanicAction({
      busy: "",
      message: "Recovered unsaved work details from this device. They will sync automatically.",
    });
  }, [
    activeWorkorder?.allowedActions?.saveNotes,
    activeWorkorder?.workorder?.id,
    form.diagnosis,
    form.workPerformed,
    isMechanicDetail,
    mechanicProgress.backup,
  ]);
  const assignedMechanicIds = activeWorkorder?.workorder?.mechanics?.map((mechanic) => mechanic.id)
    || (activeWorkorder?.workorder?.mechanic?.id ? [activeWorkorder.workorder.mechanic.id] : []);
  const detailMechanicNames = activeWorkorder?.workorder?.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
    || activeWorkorder?.workorder?.mechanic?.name
    || form.mechanicName;
  const selectedOfficeLocation = resolveCreateLocation(officeLocations, form.locationId);
  const detailLocationName = activeWorkorder?.workorder?.location?.name
    || selectedOfficeLocation?.location?.name
    || "";
  const pendingPartCount = (activeWorkorder?.partRequests || []).filter((request) => !["approved", "rejected", "cancelled"].includes(request.status)).length;
  const visibleTimeline = useMemo(
    () => (activeWorkorder?.timeline || []).filter((event) => event.type !== "access"),
    [activeWorkorder?.timeline],
  );
  const detailSections = useMemo(() => {
    return buildWorkorderDetailSections({
      activeWorkorder,
      assignedMechanicCount: assignedMechanicIds.length,
      conversationCount: conversationMessages.length,
      detailStatus,
      filledPartCount,
      isCompact,
      isMechanicDetail,
      isOfficeDetail,
      pendingPartCount,
      timelineCount: visibleTimeline.length,
      unitType: form.unitType,
    });
  }, [
    activeWorkorder,
    assignedMechanicIds.length,
    conversationMessages.length,
    detailStatus,
    filledPartCount,
    form.unitType,
    isCompact,
    isMechanicDetail,
    isOfficeDetail,
    pendingPartCount,
    visibleTimeline.length,
  ]);
  const officeAssignmentChanged = [...officeAssignment.mechanicUserIds].sort().join(",")
    !== [...assignedMechanicIds].sort().join(",");
  const expectedMechanicName = activeWorkorder?.user?.name || actor.name || "";
  const mechanicFinishNameMatches = (
    mechanicFinish.name.trim().replace(/\s+/g, " ").toLowerCase()
    === expectedMechanicName.trim().replace(/\s+/g, " ").toLowerCase()
  );

  useEffect(() => {
    const workorder = activeWorkorder?.workorder;
    if (!workorder) return;
    const canonicalTimes = canonicalPreviewTimes(workorder);
    setForm((current) => (
      current.startTime === canonicalTimes.startTime && current.endTime === canonicalTimes.endTime
        ? current
        : { ...current, ...canonicalTimes }
    ));
  }, [activeWorkorder?.workorder?.startedAt, activeWorkorder?.workorder?.mechanicDoneAt]);

  useEffect(() => {
    setUsedPartsDirty(false);
  }, [activeWorkorder?.workorder?.id]);

  useEffect(() => {
    if (!officeAutosaveRevision || !isOfficeDetail || !activeWorkorder?.allowedActions?.update) return undefined;
    window.clearTimeout(officeAutosaveTimerRef.current);
    officeAutosaveTimerRef.current = window.setTimeout(() => {
      officeAutosaveTimerRef.current = null;
      saveOfficeWorkorder({ automatic: true });
    }, 700);
    return () => window.clearTimeout(officeAutosaveTimerRef.current);
  }, [officeAutosaveRevision]);

  useEffect(() => () => window.clearTimeout(officeAutosaveTimerRef.current), []);

  useEffect(() => {
    if (!isWorkorderDetail || !activeWorkorder?.workorder?.id || !mechanicMapVehicle?.id) {
      detailLocationRefreshRef.current = "";
      return;
    }
    const refreshKey = `${activeWorkorder.workorder.id}:${mechanicMapVehicle.id}`;
    if (detailLocationRefreshRef.current === refreshKey) return;
    detailLocationRefreshRef.current = refreshKey;
    refreshVehicleLocation(mechanicMapVehicle);
  }, [activeWorkorder?.workorder?.id, isWorkorderDetail, mechanicMapVehicle?.id]);
  useAutomaticRefresh(
    () => refreshVehicleLocation(mechanicMapVehicle),
    { enabled: workspace === "generator" && Boolean(mechanicMapVehicle?.id), intervalMs: 60_000 },
  );

  useEffect(() => {
    if (!["office", "admin", "mechanic"].includes(actor.role)) return;
    const rolePath = actor.role === "mechanic" ? "mechanic" : "office";
    api(`/api/${rolePath}/template`)
      .then(({ location, template, locations }) => {
        const availableLocations = locations || [];
        const defaultLocationEntry = location
          ? { location, template }
          : availableLocations[0];
        setOfficeLocations(availableLocations);
        if (!defaultLocationEntry?.location) return;
        setForm((current) => {
          const patch = createLocationDefaultPatch({
            currentLocationId: current.locationId,
            defaultLocation: defaultLocationEntry.location,
            locations: availableLocations,
            template: defaultLocationEntry.template,
          });
          const next = { ...current, ...patch };
          if (!current.locationId || !resolveCreateLocation(availableLocations, current.locationId)) {
            createInitialDatesRef.current = createDraftBaselineFromForm(next);
          }
          return next;
        });
      })
      .catch(() => {});
  }, [actor.role]);

  async function loadDraftWorkspace() {
    if (!["office", "admin"].includes(actor.role)) return;
    setDraftWorkspaceState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await api("/api/workorder-drafts?type=workorder");
      setDraftWorkspaceState((current) => ({
        ...current,
        drafts: Array.isArray(result.drafts) ? result.drafts : [],
        loading: false,
        error: "",
      }));
    } catch (error) {
      setDraftWorkspaceState((current) => ({
        ...current,
        loading: false,
        error: error.message,
      }));
    }
  }

  useEffect(() => {
    if (!["office", "admin"].includes(workspace)) return;
    loadDraftWorkspace();
  }, [workspace]);
  useAutomaticRefresh(
    () => loadDraftWorkspace(),
    { enabled: ["office", "admin"].includes(workspace) },
  );

  useEffect(() => {
    if (activeWorkorder || workspace !== "generator") return;
    setForm((current) => {
      if (current.locationId !== form.locationId) return current;
      const patch = createLocationTemplatePatch(current, officeLocations);
      return Object.keys(patch).length ? { ...current, ...patch } : current;
    });
  }, [activeWorkorder, form.locationId, officeLocations, workspace]);

  useEffect(() => {
    const selectedLocation = resolveCreateLocation(officeLocations, form.locationId);
    if (activeWorkorder || !["office", "admin"].includes(actor.role) || !selectedLocation?.location?.id) {
      setCreateAssignment((current) => ({ ...current, mechanics: [], loading: false }));
      return;
    }
    let cancelled = false;
    setCreateAssignment((current) => ({ ...current, mechanicUserIds: [], loading: true }));
    api(`/api/office/locations/${encodeURIComponent(selectedLocation.location.id)}/mechanics`)
      .then(({ mechanics }) => {
        if (!cancelled) {
          setCreateAssignment({ mechanicUserIds: [], mechanics: mechanics || [], loading: false });
        }
      })
      .catch(() => {
        if (!cancelled) setCreateAssignment({ mechanicUserIds: [], mechanics: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [activeWorkorder, actor.role, form.locationId, officeLocations]);

  function selectOfficeLocation(locationId) {
    const selected = resolveCreateLocation(officeLocations, locationId);
    if (!selected) return;
    const locationPatch = {
      locationId: selected.location.id,
      locationName: selected.location.name || "",
      ...templateFieldsForCreateLocation(selected.location, selected.template),
    };
    clearOfficeCreateErrors("locationId");
    setForm((current) => ({
      ...current,
      ...locationPatch,
    }));
    stageOfficeWorkorderAutosave(locationPatch);
  }

  useEffect(() => {
    api("/api/config")
      .then((result) => setMapsConfig(result.maps || {}))
      .catch(() => setMapsConfig({}));
  }, []);

  useEffect(() => {
    const params = currentRouteParams();
    const workorderId = params.get("workorder");
    const draftId = params.get("draft");
    if (draftId && ["office", "admin"].includes(actor.role)) {
      api(`/api/workorder-drafts/${encodeURIComponent(draftId)}`)
        .then(({ draft }) => {
          if (workorderDraftOwnerId(draft) !== actor.id) {
            setWorkspace(actor.role === "admin" ? "admin" : "office");
            setDraftWorkspaceState((current) => ({
              ...current,
              error: "Take over this team draft before editing it.",
            }));
            replaceRouteSearch(draftsSearch());
            return;
          }
          restoreWorkorderDraft(draft);
        })
        .catch(() => finishOpenOfficeWorkspace())
        .finally(() => setRouteLoading(false));
      return;
    }
    if (!workorderId) return;
    const loadDetail = actor.role === "office" || actor.role === "admin"
      ? api(`/api/office/workorders/${encodeURIComponent(workorderId)}/opened`, {
        method: "POST",
        body: JSON.stringify({}),
      }).then(() => api(`/api/office/workorders/${encodeURIComponent(workorderId)}`)).then((detail) => {
        const editBackup = readOfficeWorkorderEditBackup(actor.id, detail.workorder.id);
        setActiveWorkorder(detail);
        setSelectedVehicle(detail.workorder.asset || null);
        setOfficeAssignment({
          mechanicUserIds: detail.workorder.mechanics?.map((mechanic) => mechanic.id)
            || (detail.workorder.mechanic?.id ? [detail.workorder.mechanic.id] : []),
          reason: "",
        });
        setPreviewPanelOpen(true);
        setDetailSource("office");
        setMode("admin");
        setDetailStatus(detail.workorder.status);
        setDetailSection(defaultDetailSection(actor.role, detail.workorder.status, isCompact));
        setSupportingView(defaultSupportingView(actor.role, detail.workorder.status));
        setForm((current) => ({ ...workorderFormValues(detail, current), ...(editBackup || {}) }));
        if (editBackup) {
          officeAutosaveRevisionRef.current += 1;
          setOfficeAutosaveRevision((current) => current + 1);
          setOfficeDetailState({ busy: false, message: "Recovered unsaved changes. Saving automatically..." });
        }
      })
      : actor.role === "mechanic"
        ? api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/opened`, {
          method: "POST",
          body: JSON.stringify({}),
        }).then(() => api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`)).then(openOperationalWorkorder)
        : Promise.reject(new Error("This role opens workorders from its own queue."));
    loadDetail
      .catch(() => returnToRoleWorkspace())
      .finally(() => setRouteLoading(false));
    // The route is only hydrated on the initial page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.role]);

  useEffect(() => {
    const draftId = workorderDraft.draft?.id;
    if (workspace !== "generator" || activeWorkorder || !draftId) return;
    const params = currentRouteParams();
    if (params.get("draft") === draftId) return;
    replaceRouteSearch(createWorkorderSearch(draftId));
  }, [activeWorkorder, workorderDraft.draft?.id, workspace]);

  useEffect(() => {
    const phoneQuery = window.matchMedia("(max-width: 700px)");
    const compactQuery = window.matchMedia("(max-width: 1180px)");
    const syncPhone = () => setIsPhone(phoneQuery.matches);
    const syncCompact = () => setIsCompact(compactQuery.matches);
    syncPhone();
    syncCompact();
    phoneQuery.addEventListener("change", syncPhone);
    compactQuery.addEventListener("change", syncCompact);
    return () => {
      phoneQuery.removeEventListener("change", syncPhone);
      compactQuery.removeEventListener("change", syncCompact);
    };
  }, []);

  useEffect(() => {
    if (!activeWorkorder || isCompact || detailSection !== "chat") return;
    setSupportingView("chat");
    setDetailSection(defaultDetailSection(actor.role, detailStatus, false));
  }, [activeWorkorder, actor.role, detailSection, detailStatus, isCompact]);

  useEffect(() => {
    setFullscreenPageIndex((current) => Math.min(current, Math.max(0, effectiveCopies - 1)));
  }, [effectiveCopies]);

  useEffect(() => {
    if (!previewFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setPreviewFullscreen(false);
      if (event.key === "ArrowLeft") setFullscreenPageIndex((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") setFullscreenPageIndex((current) => Math.min(previewSerials.length - 1, current + 1));
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewFullscreen, previewSerials.length]);

  useEffect(() => {
    if (!previewPanelOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPreviewPanelOpen(false);
        setPrintMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewPanelOpen]);


  useEffect(() => {
    let cancelled = false;
    const q = form.unitNo.trim();
    if (q.length < 2) {
      setVehicleLookup((current) => ({ ...current, loading: false, results: [] }));
      return;
    }
    if (selectedVehicle && vehicleLookupValues(selectedVehicle).includes(normalizeVehicleLookupValue(q))) {
      setVehicleLookup((current) => ({ ...current, loading: false, results: [] }));
      return;
    }

    setVehicleLookup((current) => ({ ...current, loading: true, results: [] }));
    const timer = setTimeout(() => {
      api(`/api/vehicles/search?q=${encodeURIComponent(q)}&limit=8`)
        .then((result) => {
          if (!cancelled) {
            const vehicles = result.vehicles || [];
            const exactMatch = uniqueExactVehicleMatch(vehicles, q);
            if (exactMatch) {
              applyVehicle(exactMatch);
              return;
            }
            setVehicleLookup((current) => ({
              ...current,
              loading: false,
              status: vehicles.length ? "Samsara vehicle data found." : "No vehicle match. Manual entry still works.",
              results: vehicles,
            }));
          }
        })
        .catch((error) => {
          if (!cancelled) setVehicleLookup((current) => ({ ...current, loading: false, status: error.message, results: [] }));
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.unitNo, selectedVehicle?.id]);

  function updateField(field, value) {
    clearOfficeCreateErrors(field);
    setForm((current) => ({ ...current, [field]: value }));
    stageOfficeWorkorderAutosave({ [field]: value });
  }

  function stageOfficeWorkorderAutosave(patch) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!isOfficeDetail || !activeWorkorder?.allowedActions?.update || !workorderId) return;
    writeOfficeWorkorderEditBackup(actor.id, workorderId, patch);
    officeAutosaveRevisionRef.current += 1;
    setOfficeAutosaveRevision((current) => current + 1);
  }

  function clearOfficeCreateErrors(...fields) {
    setOfficeCreateErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      fields.forEach((field) => delete next[field]);
      return next;
    });
  }

  function updateUnitNumber(value) {
    updateField("unitNo", value);
    if (selectedVehicle && !vehicleLookupValues(selectedVehicle).includes(normalizeVehicleLookupValue(value))) {
      setSelectedVehicle(null);
    }
  }

  function updateStartDate(value) {
    const workEndDate = !form.workEndDate || form.workEndDate < value ? value : form.workEndDate;
    setForm((current) => ({
      ...current,
      workDate: value,
      workStartDate: value,
      workEndDate: !current.workEndDate || current.workEndDate < value ? value : current.workEndDate,
    }));
    stageOfficeWorkorderAutosave({ workDate: value, workStartDate: value, workEndDate });
  }

  function updatePart(index, field, value) {
    setForm((current) => ({
      ...current,
      parts: current.parts.map((part, partIndex) => (partIndex === index ? { ...part, [field]: value } : part)),
    }));
  }

  function addPartRow() {
    setForm((current) => ({ ...current, parts: [...current.parts, emptyPart()] }));
  }

  function removePartRow(index) {
    setForm((current) => ({
      ...current,
      parts: current.parts.length <= 1 ? current.parts : current.parts.filter((_, partIndex) => partIndex !== index),
    }));
  }

  function updateActiveUsedParts(parts) {
    setUsedPartsDirty(true);
    setForm((current) => ({ ...current, parts }));
  }

  async function saveActiveUsedParts(parts) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) throw new Error("Open a workorder before saving parts.");
    let savedParts = parts;

    if (isOfficeDetail) {
      const result = await api(`/api/office/workorders/${workorderId}/used-parts`, {
        method: "PATCH",
        body: JSON.stringify({ parts }),
      });
      const detail = await api(`/api/office/workorders/${result.workorder.id}`);
      savedParts = detail.workorder.formData?.parts || [];
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
    } else {
      const mechanicRows = parts.map((part) => ({
        partNo: part.partNo,
        qty: part.qty,
        uomCode: part.uomCode,
        repairOrder: part.repairOrder,
      }));
      await api(`/api/mechanic/workorders/${workorderId}/used-parts`, {
        method: "PATCH",
        body: JSON.stringify({ parts: mechanicRows }),
      });
      savedParts = mechanicRows;
    }

    setForm((current) => ({ ...current, parts: savedParts }));
    if (!isOfficeDetail) {
      setActiveWorkorder((current) => current ? {
        ...current,
        workorder: {
          ...current.workorder,
          formData: { ...(current.workorder.formData || {}), parts: savedParts },
        },
      } : current);
    }
    setUsedPartsDirty(false);
  }

  function vehicleMileage(vehicle) {
    if (vehicle.last_odometer_miles) return String(Math.round(Number(vehicle.last_odometer_miles)));
    if (vehicle.last_odometer_meters) return String(Math.round(Number(vehicle.last_odometer_meters) / 1609.344));
    return "";
  }

  function vehicleModelText(vehicle) {
    const seen = new Set();
    return [vehicle.year, vehicle.make, vehicle.model]
      .filter(Boolean)
      .filter((value) => {
        const key = String(value).trim().toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .join(" ");
  }

  function applyVehicle(vehicle) {
    const modelText = vehicleModelText(vehicle);
    const vehiclePatch = {
      customerCompanyName: vehicle.owner_name || form.customerCompanyName,
      unitNo: vehicle.unit_no || vehicle.name || form.unitNo,
      unitType: vehicle.unit_type || form.unitType,
      licenseNo: vehicle.license_plate || form.licenseNo,
      mileage: vehicleMileage(vehicle) || form.mileage,
      model: modelText || form.model,
      vinNo: vehicle.vin || form.vinNo,
    };
    clearOfficeCreateErrors("unitNo", ...(vehicle.owner_name ? ["customerCompanyName"] : []));
    setForm((current) => ({
      ...current,
      customerCompanyName: vehicle.owner_name || current.customerCompanyName,
      unitNo: vehicle.unit_no || vehicle.name || current.unitNo,
      unitType: vehicle.unit_type || current.unitType,
      licenseNo: vehicle.license_plate || current.licenseNo,
      mileage: vehicleMileage(vehicle) || current.mileage,
      model: modelText || current.model,
      vinNo: vehicle.vin || current.vinNo,
    }));
    stageOfficeWorkorderAutosave(vehiclePatch);
    setVehicleLookup((current) => ({
      ...current,
      loading: false,
      status: `${vehicle.unit_no || vehicle.name || "Vehicle"} applied from Samsara.`,
      results: [],
    }));
    setSelectedVehicle(vehicle);
    refreshVehicleLocation(vehicle);
  }

  async function refreshVehicleLocation(vehicle = selectedVehicle) {
    if (!vehicle?.id) return null;
    const requestedVehicleId = vehicle.id;
    if (
      locationRequestRef.current.vehicleId === requestedVehicleId
      && locationRequestRef.current.promise
    ) {
      return locationRequestRef.current.promise;
    }

    const request = (async () => {
      try {
        const result = await api(`/api/vehicles/${encodeURIComponent(vehicle.id)}/live-location`, { method: "POST" });
        setSelectedVehicle((current) => current?.id === requestedVehicleId ? result.vehicle : current);
        return result.vehicle;
      } catch (error) {
        setVehicleLookup((current) => ({ ...current, status: error.message }));
        return null;
      } finally {
        if (locationRequestRef.current.promise === request) {
          locationRequestRef.current = { vehicleId: "", promise: null };
        }
      }
    })();
    locationRequestRef.current = { vehicleId: requestedVehicleId, promise: request };
    return request;
  }

  async function restoreDraftVehicle(payload) {
    const snapshot = selectedVehicleFromWorkorderDraft(payload);
    setSelectedVehicle(snapshot);
    if (!snapshot?.id) return;

    try {
      const result = await api(`/api/vehicles/${encodeURIComponent(snapshot.id)}`);
      setSelectedVehicle((current) => current?.id === snapshot.id ? result.vehicle : current);
      refreshVehicleLocation(result.vehicle);
    } catch (error) {
      setVehicleLookup((current) => ({ ...current, status: error.message }));
    }
  }

  async function openBrowserPrintDialog(payload) {
    setBrowserPrintPayload(payload);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.fonts?.ready) await document.fonts.ready;
    window.print();
  }

  async function printWorkorders() {
    if (!activeWorkorder?.workorder?.id) {
      setOfficeCreateState({
        busy: false,
        message: "Create the workorder before printing. Drafts do not receive serial numbers.",
      });
      return;
    }
    const workorderCount = effectiveCopies;
    const pageCount = workorderCount * workorderPhysicalPageCount(form);
    const printableForm = {
      companyName: form.customerCompanyName,
      customerCompanyName: form.customerCompanyName,
      headerTitle: form.headerTitle,
      brandTop: form.brandTop,
      brandBottom: form.brandBottom,
      warrantyText: form.warrantyText,
      responsibilityText: form.responsibilityText,
      authorizationText: form.authorizationText,
      workDate: form.workDate,
      workStartDate: form.workStartDate,
      workEndDate: form.workEndDate,
      unitNo: form.unitNo,
      unitType: form.unitType,
      licenseNo: form.licenseNo,
      mileage: form.mileage,
      model: form.model,
      vinNo: form.vinNo,
      mechanicConcern: form.mechanicConcern,
      mechanicName: form.mechanicName,
      startTime: form.startTime,
      endTime: form.endTime,
      managerName: form.managerName,
      customerSignature: form.customerSignature,
      authorizedBy: form.authorizedBy,
      parts: form.parts,
    };

    try {
      setPrintMenuOpen(false);
      await openBrowserPrintDialog({ form: printableForm, serials: previewSerials });
      setPrintState({
        open: true,
        stage: "archiving",
        message: "Saving an archived PDF copy.",
        range,
        pageCount,
      });
      const result = await api("/api/print", {
        method: "POST",
        body: JSON.stringify({
          workorderId: activeWorkorder?.workorder?.id || null,
          locationId: form.locationId || activeWorkorder?.workorder?.locationId || null,
          companyName: form.customerCompanyName,
          count: effectiveCopies,
          form: printableForm,
        }),
      });
      const printedSerials = Array.isArray(result.serials) ? result.serials : [];
      const printedRange = printedSerials.length
        ? (printedSerials.length === 1 ? printedSerials[0] : `${printedSerials[0]} to ${printedSerials.at(-1)}`)
        : range;
      setPrintState({
        open: true,
        stage: "printing",
        message: "Opening your browser print dialog.",
        downloadUrl: result.downloadUrl,
        range: printedRange,
        pageCount: (printedSerials.length || effectiveCopies) * workorderPhysicalPageCount(result.printForm || printableForm),
      });
      setPrintState({
        open: true,
        stage: "done",
        message: "Print dialog closed. The archived PDF is ready below.",
        downloadUrl: result.downloadUrl,
        range: printedRange,
        pageCount: (printedSerials.length || effectiveCopies) * workorderPhysicalPageCount(result.printForm || printableForm),
      });
    } catch (error) {
      setPrintState({ open: true, stage: "error", message: error.message, pageCount });
    }
  }

  async function createOfficeWorkorder(event) {
    event?.preventDefault?.();
    const errors = validateCreateWorkorder(form);
    if (Object.keys(errors).length) {
      setOfficeCreateErrors(errors);
      setOfficeCreateAttempt((attempt) => attempt + 1);
      setOfficeCreateState({ busy: false, message: "Fix the highlighted fields before creating the workorder." });
      return;
    }
    setOfficeCreateErrors({});
    setOfficeCreateAttempt(0);
    setOfficeCreateState({ busy: true, message: "Creating workorder..." });
    try {
      if (actor.role === "mechanic") {
        const result = await api("/api/mechanic/workorders", {
          method: "POST",
          body: JSON.stringify(workorderDraftPayload),
        });
        setOfficeCreateState({ busy: false, message: `${result.workorder.serial} created and assigned to you.` });
        const detail = await api(`/api/mechanic/workorders/${encodeURIComponent(result.workorder.id)}`);
        openOperationalWorkorder(detail);
        return;
      }
      const savedDraft = await workorderDraft.flush();
      if (!savedDraft?.id || !savedDraft?.version) {
        throw new Error("The draft could not be saved. Try again before creating the workorder.");
      }
      const result = await api(`/api/workorder-drafts/${encodeURIComponent(savedDraft.id)}/submit`, {
        method: "POST",
        body: JSON.stringify({
          version: savedDraft.version,
        }),
      });
      workorderDraft.reset(null);
      setResumedDraft(null);
      setOfficeCreateState({
        busy: false,
        message: createAssignment.mechanicUserIds.length
          ? `${result.workorder.serial} created and assigned.`
          : `${result.workorder.serial} added to the available queue.`,
      });
      const opened = await openOfficeWorkorder(result.workorder.id);
      if (!opened) finishOpenOfficeWorkspace();
    } catch (error) {
      setOfficeCreateState({ busy: false, message: error.message });
    }
  }

  function workorderFormValues(detail, current = form) {
    const workorder = detail.workorder;
    const asset = workorder.asset || {};
    const savedForm = workorder.formData || {};
    const serial = splitSerial(workorder.serial);
    const model = [asset.year, asset.make, asset.model].filter(Boolean).join(" ");
    const savedParts = normalizeUsedParts(savedForm.parts);
    const assignedMechanicName = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || workorder.mechanic?.name
      || (detail.user?.role === "mechanic" ? detail.user.name : "");
    const approvalName = canonicalApprovalName(workorder);
    const mechanicProgressFields = resolveMechanicProgressFields(workorder, savedForm);
    const canonicalPreviewTemplate = canonicalDetailPreviewTemplate(workorder, officeLocations);

    return {
      ...current,
      ...savedForm,
      ...canonicalPreviewTemplate,
      ...serial,
      copies: 1,
      locationId: workorder.locationId || workorder.location?.id || current.locationId,
      companyName: savedForm.customerCompanyName || savedForm.companyName || asset.ownerName || asset.owner_name || "",
      customerCompanyName: savedForm.customerCompanyName || savedForm.companyName || asset.ownerName || asset.owner_name || "",
      unitNo: savedForm.unitNo || asset.unitNo || asset.name || "",
      unitType: savedForm.unitType || asset.unitType || "",
      licenseNo: savedForm.licenseNo || asset.licensePlate || "",
      mileage: savedForm.mileage || (asset.lastOdometerMiles ? String(Math.round(Number(asset.lastOdometerMiles))) : ""),
      model: savedForm.model || model,
      vinNo: savedForm.vinNo || asset.vin || "",
      mechanicConcern: savedForm.mechanicConcern || workorder.concern || "",
      ...mechanicProgressFields,
      mechanicName: assignedMechanicName || savedForm.mechanicName,
      officeNotes: workorder.officeNotes || savedForm.officeNotes || "",
      managerName: approvalName || savedForm.managerName || "",
      authorizedBy: approvalName || savedForm.authorizedBy || "",
      ...canonicalPreviewTimes(workorder),
      parts: savedParts,
    };
  }

  function openOperationalWorkorder(detail) {
    const workorder = detail.workorder;
    const requestedSection = currentRouteParams().get("section");
    const compactSections = ["work", "chat", "parts", "preview", "unit", "activity"];
    const nextSection = compactSections.includes(requestedSection)
      ? requestedSection
      : defaultDetailSection("mechanic", workorder.status, isCompact);
    setActiveWorkorder(detail);
    setPreviewPanelOpen(true);
    setDetailSource("mechanic");
    setMode("mechanic");
    setDetailStatus(workorder.status);
    setSelectedVehicle(workorder.asset || null);
    setMechanicAction({ busy: "", message: "" });
    setDetailSection(nextSection === "chat" && !isCompact ? "work" : nextSection);
    setSupportingView(nextSection === "chat" ? "chat" : defaultSupportingView("mechanic", workorder.status));
    setForm((current) => workorderFormValues(detail, current));
    setWorkspace("generator");
    replaceRouteSearch(workorderDetailSearch(workorder.id, nextSection));
  }

  async function openOfficeWorkorder(workorderId) {
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await api(`/api/office/workorders/${encodeURIComponent(workorderId)}/opened`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const detail = await api(`/api/office/workorders/${encodeURIComponent(workorderId)}`);
      const workorder = detail.workorder;
      const editBackup = readOfficeWorkorderEditBackup(actor.id, workorder.id);
      setActiveWorkorder(detail);
      setSelectedVehicle(workorder.asset || null);
      setOfficeAssignment({
        mechanicUserIds: workorder.mechanics?.map((mechanic) => mechanic.id)
          || (workorder.mechanic?.id ? [workorder.mechanic.id] : []),
        reason: "",
      });
      setPreviewPanelOpen(true);
      setDetailSource("office");
      setMode("admin");
      setDetailStatus(workorder.status);
      setDetailSection(defaultDetailSection(actor.role, workorder.status, isCompact));
      setSupportingView(defaultSupportingView(actor.role, workorder.status));
      setForm((current) => ({ ...workorderFormValues(detail, current), ...(editBackup || {}) }));
      setWorkspace("generator");
      if (editBackup) {
        officeAutosaveRevisionRef.current += 1;
        setOfficeAutosaveRevision((current) => current + 1);
      }
      setOfficeDetailState({
        busy: false,
        message: editBackup ? "Recovered unsaved changes. Saving automatically..." : "",
      });
      replaceRouteSearch(workorderDetailSearch(workorder.id));
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
      return false;
    }
  }

  async function saveOfficeWorkorder(options = {}) {
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    window.clearTimeout(officeAutosaveTimerRef.current);
    officeAutosaveTimerRef.current = null;
    if (officeAutosaveInFlightRef.current) {
      officeAutosaveQueuedRef.current = true;
      return;
    }
    const automatic = options?.automatic === true;
    const savingRevision = officeAutosaveRevisionRef.current;
    officeAutosaveInFlightRef.current = true;
    setOfficeDetailState({ busy: true, message: "Saving..." });
    try {
      const savedAdministrativeForm = Object.fromEntries(
        Object.entries(activeWorkorder.workorder.formData || {}).filter(([key]) => (
          !["diagnosis", "workPerformed", "mechanicName", "startTime", "endTime", "managerName"].includes(key)
        )),
      );
      const formData = {
        ...savedAdministrativeForm,
        companyName: form.customerCompanyName,
        customerCompanyName: form.customerCompanyName,
        headerTitle: form.headerTitle,
        brandTop: form.brandTop,
        brandBottom: form.brandBottom,
        warrantyText: form.warrantyText,
        responsibilityText: form.responsibilityText,
        authorizationText: form.authorizationText,
        workDate: form.workDate,
        workStartDate: form.workStartDate,
        workEndDate: form.workEndDate,
        unitNo: form.unitNo,
        unitType: form.unitType,
        licenseNo: form.licenseNo,
        mileage: form.mileage,
        model: form.model,
        vinNo: form.vinNo,
        mechanicConcern: form.mechanicConcern,
        customerSignature: form.customerSignature,
        authorizedBy: form.authorizedBy,
        parts: form.parts,
      };
      const result = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          assetId: selectedVehicle?.id || activeWorkorder.workorder.asset?.id || null,
          locationId: form.locationId || activeWorkorder.workorder.locationId || null,
          concern: form.mechanicConcern,
          officeNotes: form.officeNotes || "",
          formData,
          expectedUpdatedAt: activeWorkorder.workorder.updatedAt,
        }),
      });
      const detail = await api(`/api/office/workorders/${result.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      if (!automatic) setForm((current) => workorderFormValues(detail, current));
      if (officeAutosaveRevisionRef.current === savingRevision) {
        clearOfficeWorkorderEditBackup(actor.id, detail.workorder.id);
      }
      setOfficeDetailState({
        busy: false,
        message: automatic ? "Saved automatically." : "Saved. Mechanic view will update from this record.",
      });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    } finally {
      officeAutosaveInFlightRef.current = false;
      if (officeAutosaveQueuedRef.current || officeAutosaveRevisionRef.current > savingRevision) {
        officeAutosaveQueuedRef.current = false;
        setOfficeAutosaveRevision((current) => current + 1);
      }
    }
  }

  async function closeOfficeWorkorder(event) {
    event.preventDefault();
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await api(`/api/office/workorders/${activeWorkorder.workorder.id}/close`, {
        method: "POST",
        body: JSON.stringify({ note: officeCloseNote }),
      });
      const detail = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      setOfficeCloseOpen(false);
      setOfficeCloseNote("");
      setOfficeDetailState({ busy: false, message: "Workorder approved and sent to surveillance." });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    }
  }

  function openOfficeReturn() {
    setOfficeDetailState((current) => ({ ...current, message: "" }));
    setOfficeReturn({ open: true, reason: "", categories: [], message: "" });
  }

  function openOfficeCancel() {
    setOfficeDetailState((current) => ({ ...current, message: "" }));
    setOfficeCancel({ open: true, reason: "", message: "" });
  }

  async function returnOfficeWorkorder(event) {
    event.preventDefault();
    const reason = officeReturn.reason.trim();
    if (reason.length < 2) {
      setOfficeReturn((current) => ({ ...current, message: "Add a reason for the mechanic." }));
      return;
    }
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await api(`/api/office/workorders/${activeWorkorder.workorder.id}/return`, {
        method: "POST",
        body: JSON.stringify({ reason, categories: officeReturn.categories }),
      });
      const detail = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      setOfficeReturn({ open: false, reason: "", categories: [], message: "" });
      setOfficeDetailState({ busy: false, message: "Returned to the mechanic with your requested changes." });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: "" });
      setOfficeReturn((current) => ({ ...current, message: error.message }));
    }
  }

  async function cancelOfficeWorkorder(event) {
    event.preventDefault();
    const reason = officeCancel.reason.trim();
    if (reason.length < 2) {
      setOfficeCancel((current) => ({ ...current, message: "Add a cancellation reason." }));
      return;
    }
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await api(`/api/office/workorders/${activeWorkorder.workorder.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      const detail = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      setOfficeCancel({ open: false, reason: "", message: "" });
      setOfficeDetailState({ busy: false, message: "Workorder cancelled. The reason remains in Activity." });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: "" });
      setOfficeCancel((current) => ({ ...current, message: error.message }));
    }
  }

  async function updateOfficeMechanicTeam() {
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    const reason = officeAssignment.reason.trim();
    if (!reason) {
      setOfficeDetailState({ busy: false, message: "Add a reason before changing the mechanic team." });
      return;
    }
    setOfficeDetailState({ busy: true, message: "Updating assignment..." });
    try {
      await api(`/api/office/workorders/${activeWorkorder.workorder.id}/assignments`, {
        method: "POST",
        body: JSON.stringify({
          mechanicUserIds: officeAssignment.mechanicUserIds,
          reason,
        }),
      });
      const detail = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      const team = detail.workorder.mechanics || [];
      setOfficeAssignment({ mechanicUserIds: team.map((mechanic) => mechanic.id), reason: "" });
      setOfficeDetailState({
        busy: false,
        message: team.length
          ? `Assigned to ${team.map((mechanic) => mechanic.name).join(", ")}.`
          : "Workorder returned to the available queue.",
      });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
    }
  }

  function openOfficeGenerator() {
    const createDate = todayIso();
    workorderDraft.reset(null);
    setResumedDraft(null);
    setDraftLeaveOpen(false);
    setActiveWorkorder(null);
    setSelectedVehicle(null);
    setVehicleLookup({ loading: false, status: "", results: [] });
    setForm((current) => {
      const next = {
        ...current,
        customerCompanyName: "",
        unitNo: "",
        unitType: "",
        licenseNo: "",
        mileage: "",
        model: "",
        vinNo: "",
        mechanicConcern: "",
        diagnosis: "",
        workPerformed: "",
        mechanicName: actor.role === "mechanic" ? actor.name || "" : "",
        startTime: "",
        endTime: "",
        managerName: "",
        officeNotes: "",
        customerSignature: "",
        authorizedBy: "",
        workDate: createDate,
        workStartDate: createDate,
        workEndDate: createDate,
        parts: [emptyPart(), emptyPart(), emptyPart()],
      };
      createInitialDatesRef.current = createDraftBaselineFromForm(next);
      return next;
    });
    setPreviewPanelOpen(true);
    setDetailSource(null);
    setMode(actor.role === "mechanic" ? "mechanic" : "admin");
    setOfficeCreateErrors({});
    setOfficeCreateState({ busy: false, message: "" });
    setCreateAssignment((current) => ({ ...current, mechanicUserIds: [] }));
    setWorkspace("generator");
    replaceRouteSearch(createWorkorderSearch());
  }

  function finishOpenOfficeWorkspace() {
    setDraftLeaveOpen(false);
    setDraftLeaveBusy(false);
    setActiveWorkorder(null);
    setSelectedVehicle(null);
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace(defaultWorkspaceForRole(actor.role));
    replaceRouteSearch("");
  }

  function openOfficeWorkspace() {
    const leavingCreate = workspace === "generator" && !activeWorkorder;
    if (leavingCreate && (workorderDraftMeaningful || workorderDraft.draft?.id)) {
      setDraftLeaveOpen(true);
      return;
    }
    finishOpenOfficeWorkspace();
  }

  function restoreWorkorderDraft(draft) {
    setForm((current) => formValuesFromWorkorderDraft(draft.payload, current));
    setCreateAssignment((current) => ({
      ...current,
      mechanicUserIds: draft.payload?.mechanicUserIds || [],
    }));
    restoreDraftVehicle(draft.payload);
    setResumedDraft(draft);
    workorderDraft.reset(draft);
    setActiveWorkorder(null);
    setPreviewPanelOpen(true);
    setDetailSource(null);
    setMode("admin");
    setWorkspace("generator");
    setOfficeCreateState({ busy: false, message: "Draft restored." });
    replaceRouteSearch(createWorkorderSearch(draft.id));
  }

  async function openSavedDraft(draft) {
    setDraftWorkspaceState((current) => ({ ...current, busyId: draft.id, error: "" }));
    try {
      const result = await api(`/api/workorder-drafts/${encodeURIComponent(draft.id)}`);
      restoreWorkorderDraft(result.draft);
    } catch (error) {
      setDraftWorkspaceState((current) => ({ ...current, error: error.message }));
    } finally {
      setDraftWorkspaceState((current) => ({ ...current, busyId: "" }));
    }
  }

  async function takeOverDraft(draft) {
    setDraftWorkspaceState((current) => ({ ...current, busyId: draft.id, error: "" }));
    try {
      const result = await api(`/api/workorder-drafts/${encodeURIComponent(draft.id)}/takeover`, {
        method: "POST",
        body: JSON.stringify({ version: draft.version }),
      });
      restoreWorkorderDraft(result.draft);
    } catch (error) {
      setDraftWorkspaceState((current) => ({ ...current, error: error.message }));
    } finally {
      setDraftWorkspaceState((current) => ({ ...current, busyId: "" }));
    }
  }

  async function discardDraftFromWorkspace(draft) {
    setDraftWorkspaceState((current) => ({ ...current, busyId: draft.id, error: "" }));
    try {
      await discardWorkorderDraft(draft.id);
      await loadDraftWorkspace();
    } catch (error) {
      setDraftWorkspaceState((current) => ({ ...current, error: error.message }));
      throw error;
    } finally {
      setDraftWorkspaceState((current) => ({ ...current, busyId: "" }));
    }
  }

  async function saveDraftAndLeave() {
    setDraftLeaveBusy(true);
    try {
      await workorderDraft.flush();
      workorderDraft.reset(null);
      setResumedDraft(null);
      finishOpenOfficeWorkspace();
    } catch (error) {
      setOfficeCreateState({ busy: false, message: error.message });
    } finally {
      setDraftLeaveBusy(false);
    }
  }

  async function discardDraftAndLeave() {
    setDraftLeaveBusy(true);
    try {
      await workorderDraft.discard();
      setResumedDraft(null);
      finishOpenOfficeWorkspace();
    } catch (error) {
      setOfficeCreateState({ busy: false, message: error.message });
    } finally {
      setDraftLeaveBusy(false);
    }
  }

  function returnToRoleWorkspace() {
    if (actor.role === "admin" || actor.role === "office") {
      openOfficeWorkspace();
      return;
    }
    if (activeWorkorder) returnToMyWork();
    else finishOpenOfficeWorkspace();
  }

  async function returnToMyWork() {
    if (isMechanicDetail && mechanicProgress.hasUnsyncedChanges) {
      setMechanicAction({ busy: "progress", message: "Saving progress before leaving..." });
      try {
        await mechanicProgress.flush({ recordActivity: true });
      } catch (error) {
        setMechanicAction({
          busy: "",
          message: `${error.message} Your recovery copy is still on this device. Retry before leaving.`,
        });
        return false;
      }
    }
    setActiveWorkorder(null);
    setSelectedVehicle(null);
    setMechanicFinish({ open: false, name: "", message: "" });
    setOfficeReturn({ open: false, reason: "", categories: [], message: "" });
    setOfficeCancel({ open: false, reason: "", message: "" });
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace("mechanic");
    replaceRouteSearch("");
    return true;
  }

  async function runMechanicAction(name, request, successMessage, nextStatus) {
    if (!activeWorkorder) return;
    setMechanicAction({ busy: name, message: "" });
    try {
      const result = await request(activeWorkorder);
      const nextWorkorder = result?.workorder;
      const nextMessage = result?.message;
      if (nextWorkorder) {
        setActiveWorkorder((current) => ({ ...current, workorder: nextWorkorder }));
        setDetailStatus(nextWorkorder.status);
      } else if (nextMessage) {
        setActiveWorkorder((current) => ({
          ...current,
          messages: [
            ...(current?.messages || []),
            {
              ...nextMessage,
              senderName: nextMessage.senderName || current?.user?.name || "You",
            },
          ],
          workorder: nextStatus ? { ...current.workorder, status: nextStatus } : current.workorder,
        }));
        if (nextStatus) setDetailStatus(nextStatus);
      } else if (nextStatus) {
        setDetailStatus(nextStatus);
      }
      setMechanicAction({ busy: "", message: successMessage });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
  }

  async function sendWorkorderChat({ body, attachment, clientMessageId }) {
    const workorderId = activeWorkorder?.workorder?.id;
    if ((!body && !attachment) || !workorderId) return false;

    setMechanicAction({ busy: "chat", message: "" });
    try {
      const rolePath = isOfficeDetail ? "office" : "mechanic";
      await api(`/api/${rolePath}/workorders/${workorderId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          body,
          clientMessageId,
          ...(attachment ? { attachment } : {}),
        }),
      });
      await reloadActiveWorkorder();
      setMechanicAction({ busy: "", message: "" });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
  }

  function shouldPreserveActiveWorkorderForm() {
    if (isMechanicDetail && (mechanicProgress.hasUnsyncedChanges || mechanicProgress.status === "saving")) return true;
    const activeElement = document.activeElement;
    return Boolean(activeElement?.closest?.(".workorder-detail-page input, .workorder-detail-page textarea, .workorder-detail-page select, .workorder-detail-page [contenteditable='true']"));
  }

  async function reloadActiveWorkorder(options = {}) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) return;
    const detail = isOfficeDetail
      ? await api(`/api/office/workorders/${encodeURIComponent(workorderId)}`)
      : await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`);
    setActiveWorkorder(detail);
    setDetailStatus(detail.workorder.status);
    if (!options.preserveForm) {
      setForm((current) => workorderFormValues(detail, current));
    }
  }

  useWorkorderDetailRealtime({
    enabled: Boolean(activeWorkorder?.workorder?.id && ["office", "mechanic"].includes(detailSource)),
    workorderId: activeWorkorder?.workorder?.id,
    paused: usedPartsDirty || (
      isMechanicDetail
      && (mechanicProgress.hasUnsyncedChanges || mechanicProgress.status === "saving")
    ),
    onRefresh: () => reloadActiveWorkorder({ preserveForm: shouldPreserveActiveWorkorderForm() }),
  });

  async function saveMechanicWorkNotes() {
    if (!activeWorkorder?.workorder?.id || !isMechanicDetail) return;
    setMechanicAction({ busy: "notes", message: "" });
    try {
      await mechanicProgress.flush({ recordActivity: true });
      setMechanicAction({ busy: "", message: "Work details saved." });
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
    }
  }

  async function acceptOpenedMechanicWorkorder() {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isMechanicDetail) return false;
    setMechanicAction({ busy: "accept", message: "" });
    try {
      await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const detail = await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      mechanicProgress.reset({
        id: detail.workorder.id,
        progress: detail.workorder,
        nextVersion: detail.workorder.progressVersion,
      });
      setMechanicAction({ busy: "", message: "Work accepted. You can start recording progress." });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
  }

  async function markMechanicWorkDone(confirmationName) {
    try {
      await mechanicProgress.flush({ recordActivity: true });
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
    return runMechanicAction(
      "done",
      (detail) => api(`/api/mechanic/workorders/${detail.workorder.id}/mark-done`, {
        method: "POST",
        body: JSON.stringify({
          diagnosis: form.diagnosis,
          workPerformed: form.workPerformed,
          confirmationName,
        }),
      }),
      "Work sent to office for review.",
    );
  }

  async function submitMechanicFinish(event) {
    event.preventDefault();
    if (!form.workPerformed.trim()) {
      setMechanicFinish((current) => ({
        ...current,
        message: "Add the work performed before marking the work as done.",
      }));
      return;
    }
    if (!mechanicFinishNameMatches) {
      setMechanicFinish((current) => ({
        ...current,
        message: `Write ${expectedMechanicName} to confirm the work is done.`,
      }));
      return;
    }
    const finished = await markMechanicWorkDone(mechanicFinish.name);
    if (finished) setMechanicFinish({ open: false, name: "", message: "" });
  }

  function jumpToPreview() {
    if (isWorkorderDetail && isCompact) {
      setFullscreenPageIndex(0);
      setFullscreenZoom(isPhone ? 0 : 1);
      setPreviewFullscreen(true);
      return;
    }
    if (supportingView !== "preview" || !previewPanelOpen) {
      setSupportingView("preview");
      setPreviewPanelOpen(true);
      return;
    }
    setPreviewPanelOpen((open) => {
      if (open) setPrintMenuOpen(false);
      return !open;
    });
  }

  function toggleWorkorderTools() {
    if (isCompact) {
      jumpToPreview();
      return;
    }
    setPreviewPanelOpen((open) => !open);
    setPrintMenuOpen(false);
  }

  function selectDetailSection(section) {
    if (section === "chat" && !isCompact) {
      setSupportingView("chat");
      setPreviewPanelOpen(true);
      if (activeWorkorder?.workorder?.id) {
        replaceRouteSearch(workorderDetailSearch(activeWorkorder.workorder.id, "chat"));
      }
      return;
    }
    setDetailSection(section);
    if (activeWorkorder?.workorder?.id) {
      replaceRouteSearch(workorderDetailSearch(activeWorkorder.workorder.id, section));
    }
  }

  function openFullscreenPreview() {
    setPrintMenuOpen(false);
    setFullscreenPageIndex(0);
    setFullscreenZoom(isPhone ? 0 : 1);
    setPreviewFullscreen(true);
  }

  if (routeLoading) {
    return (
      <main className="prototype mechanic-home route-loading">
        <div className="mechanic-empty-state">
          <RefreshCw01 className="loading-icon" />
          <strong>Opening workorder...</strong>
        </div>
      </main>
    );
  }

  if (workspace === "mechanic") {
    return <MechanicWorkspace actor={actor} onCreateWorkorder={openOfficeGenerator} onOpenWorkorder={openOperationalWorkorder} />;
  }

  if (workspace === "admin") {
    return (
      <Suspense fallback={null}>
        <AdminWorkspace
          actor={actor}
          drafts={draftWorkspaceState.drafts}
          draftLoading={draftWorkspaceState.loading}
          draftError={draftWorkspaceState.error}
          draftBusyId={draftWorkspaceState.busyId}
          onCreateWorkorder={openOfficeGenerator}
          onOpenDraft={openSavedDraft}
          onDiscardDraft={discardDraftFromWorkspace}
          onTakeoverDraft={takeOverDraft}
          onRefreshDrafts={loadDraftWorkspace}
          onOpenWorkorder={openOfficeWorkorder}
        />
      </Suspense>
    );
  }

  if (workspace === "office") {
    return (
      <OfficeWorkspace
        actor={actor}
        drafts={draftWorkspaceState.drafts}
        draftLoading={draftWorkspaceState.loading}
        draftError={draftWorkspaceState.error}
        draftBusyId={draftWorkspaceState.busyId}
        onCreateWorkorder={openOfficeGenerator}
        onOpenDraft={openSavedDraft}
        onDiscardDraft={discardDraftFromWorkspace}
        onTakeoverDraft={takeOverDraft}
        onRefreshDrafts={loadDraftWorkspace}
        onOpenWorkorder={openOfficeWorkorder}
      />
    );
  }

  if (workspace === "surveillance") {
    return <SurveillanceWorkspace actor={actor} />;
  }

  if (activeWorkorder) {
    return (
      <WorkorderDetailPage
        activeWorkorder={activeWorkorder}
        actor={actor}
        assignedMechanicIds={assignedMechanicIds}
        browserPrintPayload={browserPrintPayload}
        canPrint={canPrint}
        conversationMessages={conversationMessages}
        currentStatusLabel={currentStatusLabel}
        detailMechanicNames={detailMechanicNames}
        detailLocationName={detailLocationName}
        detailSection={detailSection}
        detailSections={detailSections}
        detailStatus={detailStatus}
        effectiveCopies={effectiveCopies}
        expectedMechanicName={expectedMechanicName}
        filledPartCount={filledPartCount}
        firstSerial={firstSerial}
        form={form}
        formRef={formRef}
        fullscreenPageIndex={fullscreenPageIndex}
        fullscreenZoom={fullscreenZoom}
        isCompact={isCompact}
        isMechanicDetail={isMechanicDetail}
        isOfficeDetail={isOfficeDetail}
        isPhone={isPhone}
        lastPhysicalPageIndex={lastPhysicalPageIndex}
        lastSerial={lastSerial}
        mapsConfig={mapsConfig}
        mechanicAction={mechanicAction}
        mechanicAsset={mechanicAsset}
        mechanicFinish={mechanicFinish}
        mechanicFinishNameMatches={mechanicFinishNameMatches}
        mechanicMapLocation={mechanicMapLocation}
        mechanicMapVehicle={mechanicMapVehicle}
        mechanicProgress={mechanicProgress}
        mechanicUnitType={mechanicUnitType}
        mechanicVehicleLabel={mechanicVehicleLabel}
        officeAssignment={officeAssignment}
        officeAssignmentChanged={officeAssignmentChanged}
        officeCloseNote={officeCloseNote}
        officeCloseOpen={officeCloseOpen}
        officeReturn={officeReturn}
        officeCancel={officeCancel}
        officeDetailState={officeDetailState}
        officeLocations={officeLocations}
        pendingPartCount={pendingPartCount}
        previewFullscreen={previewFullscreen}
        previewGridRef={previewGridRef}
        previewPanelOpen={previewPanelOpen}
        previewRef={previewRef}
        previewSerials={previewSerials}
        printMenuOpen={printMenuOpen}
        printState={printState}
        primaryActionLabel={primaryActionLabel}
        range={range}
        selectedVehicle={selectedVehicle}
        showEmbeddedPreview={showEmbeddedPreview}
        supportingView={supportingView}
        vehicleLookup={vehicleLookup}
        visibleTimeline={visibleTimeline}
        workorderCountLabel={workorderCountLabel}
        applyVehicle={applyVehicle}
        closeOfficeWorkorder={closeOfficeWorkorder}
        cancelOfficeWorkorder={cancelOfficeWorkorder}
        jumpToPreview={jumpToPreview}
        openFullscreenPreview={openFullscreenPreview}
        acceptOpenedMechanicWorkorder={acceptOpenedMechanicWorkorder}
        printWorkorders={printWorkorders}
        openOfficeCancel={openOfficeCancel}
        openOfficeReturn={openOfficeReturn}
        reloadActiveWorkorder={reloadActiveWorkorder}
        returnToRoleWorkspace={returnToRoleWorkspace}
        saveActiveUsedParts={saveActiveUsedParts}
        saveMechanicWorkNotes={saveMechanicWorkNotes}
        saveOfficeWorkorder={saveOfficeWorkorder}
        selectDetailSection={selectDetailSection}
        selectOfficeLocation={selectOfficeLocation}
        sendWorkorderChat={sendWorkorderChat}
        setDetailSection={setDetailSection}
        setFullscreenPageIndex={setFullscreenPageIndex}
        setFullscreenZoom={setFullscreenZoom}
        setMechanicFinish={setMechanicFinish}
        setOfficeAssignment={setOfficeAssignment}
        setOfficeCloseNote={setOfficeCloseNote}
        setOfficeCloseOpen={setOfficeCloseOpen}
        setOfficeReturn={setOfficeReturn}
        setOfficeCancel={setOfficeCancel}
        setOfficeDetailState={setOfficeDetailState}
        setPreviewFullscreen={setPreviewFullscreen}
        setPrintMenuOpen={setPrintMenuOpen}
        setPrintState={setPrintState}
        setSupportingView={setSupportingView}
        submitMechanicFinish={submitMechanicFinish}
        returnOfficeWorkorder={returnOfficeWorkorder}
        toggleWorkorderTools={toggleWorkorderTools}
        updateActiveUsedParts={updateActiveUsedParts}
        updateField={updateField}
        updateOfficeMechanicTeam={updateOfficeMechanicTeam}
        updateStartDate={updateStartDate}
        updateUnitNumber={updateUnitNumber}
        vehicleMileage={vehicleMileage}
        vehicleModelText={vehicleModelText}
      />
    );
  }

  return (
    <CreateWorkorderPage
      actor={actor}
      assignment={createAssignmentForRole}
      browserPrintPayload={browserPrintPayload}
      effectiveCopies={effectiveCopies}
      firstSerial={firstSerial}
      form={form}
      formRef={formRef}
      fullscreenPageIndex={fullscreenPageIndex}
      fullscreenZoom={fullscreenZoom}
      isPhone={isPhone}
      lastPhysicalPageIndex={lastPhysicalPageIndex}
      lastSerial={lastSerial}
      mapsConfig={mapsConfig}
      officeCreateAttempt={officeCreateAttempt}
      officeCreateErrors={officeCreateErrors}
      officeCreateState={officeCreateState}
      officeLocations={officeLocations}
      previewFullscreen={previewFullscreen}
      previewGridRef={previewGridRef}
      previewRef={previewRef}
      previewSerials={previewSerials}
      printMenuOpen={printMenuOpen}
      printState={printState}
      primaryActionLabel={primaryActionLabel}
      range={range}
      selectedVehicle={selectedVehicle}
      showEmbeddedPreview={showEmbeddedPreview}
      vehicleLookup={vehicleLookup}
      workorderCountLabel={workorderCountLabel}
      workorderDraft={workorderDraft}
      draftLeaveBusy={draftLeaveBusy}
      draftLeaveOpen={draftLeaveOpen}
      addPartRow={addPartRow}
      createOfficeWorkorder={createOfficeWorkorder}
      discardDraftAndLeave={discardDraftAndLeave}
      jumpToPreview={jumpToPreview}
      openOfficeWorkspace={openOfficeWorkspace}
      openFullscreenPreview={openFullscreenPreview}
      removePartRow={removePartRow}
      saveDraftAndLeave={saveDraftAndLeave}
      setCreateAssignment={setCreateAssignment}
      setDraftLeaveOpen={setDraftLeaveOpen}
      setFullscreenPageIndex={setFullscreenPageIndex}
      setFullscreenZoom={setFullscreenZoom}
      setPreviewFullscreen={setPreviewFullscreen}
      setPrintMenuOpen={setPrintMenuOpen}
      setPrintState={setPrintState}
      selectOfficeLocation={selectOfficeLocation}
      updateField={updateField}
      updatePart={updatePart}
      updateUnitNumber={updateUnitNumber}
      applyVehicle={applyVehicle}
    />
  );
}

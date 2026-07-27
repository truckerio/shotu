import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle, Plus, RefreshCw01, Save01, XClose } from "@untitledui/icons";
import { PreviewPane, PreviewToggle } from "../components/preview/PreviewPane.jsx";
import {
  DraftLeaveDialog,
  DraftSaveStatus,
  useDraftForm,
  useUnsavedBrowserGuard,
} from "../components/drafts/index.js";
import { Button } from "../components/ui/Button.jsx";
import { ChatComposer } from "../components/workorders/ChatComposer.jsx";
import { ChatThread } from "../components/workorders/ChatThread.jsx";
import { PartRequestsPanel } from "../components/workorders/PartRequestsPanel.jsx";
import { AssetLocationCard, getVehicleLocation } from "../components/workorders/AssetLocationCard.jsx";
import { WorkorderDetailLayout } from "../components/workorders/WorkorderDetailLayout.jsx";
import {
  ProgressiveWorkorderSection,
  WorkorderObjectSummary,
  WorkorderSectionNav,
} from "../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderTimelinePanel } from "../components/workorders/WorkorderTimeline.jsx";
import { WorkorderStatusPill } from "../components/workorders/WorkorderStatusPill.jsx";
import {
  CustomerCompanyField,
  FormField as OperationalFormField,
  FormSection,
  MechanicMultiSelect,
} from "../components/forms/index.js";
import { MechanicWorkspace } from "../features/mechanic/MechanicWorkspace.jsx";
import { MechanicProgressStatus } from "../features/mechanic/progress/MechanicProgressStatus.jsx";
import { useMechanicProgress } from "../features/mechanic/progress/useMechanicProgress.js";
import { OfficeWorkspace } from "../features/office/OfficeWorkspace.jsx";
import { SurveillanceWorkspace } from "../features/surveillance/SurveillanceWorkspace.jsx";
import { BrowserPrintDocument, Field, PreviewFullscreen, PrintModal, WorkorderPreview } from "../features/generator/GeneratorUi.jsx";
import { CREATE_WORKORDER_FORM_ID, CreateWorkorderForm } from "../features/generator/CreateWorkorderForm.jsx";
import { validateCreateWorkorder } from "../features/generator/create-workorder-validation.js";
import {
  buildWorkorderDraftPayload,
  formValuesFromWorkorderDraft,
  isMeaningfulWorkorderDraft,
  selectedVehicleFromWorkorderDraft,
} from "../features/generator/workorder-draft.js";
import { useAutomaticRefresh } from "../hooks/useAutomaticRefresh.js";
import { api } from "../lib/api.js";
import { emptyPart, workDateRangeLabel, workorderPhysicalPageCount, workorderTemplateStyles } from "../../../shared/workorder-template.js";
import "../styles.css";

const AdminWorkspace = lazy(() => import("../features/admin/AdminWorkspace.jsx").then((module) => ({ default: module.AdminWorkspace })));

const todayIso = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

function splitSerial(serial = "") {
  const match = /^(.*?)(\d+)$/.exec(serial.trim());
  if (!match) return { prefix: "WO-", nextNumber: 1, digits: 6 };
  return { prefix: match[1], nextNumber: Number(match[2]), digits: match[2].length };
}

function normalizeVehicleLookupValue(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function vehicleLookupValues(vehicle) {
  return [vehicle?.unit_no, vehicle?.unitNo, vehicle?.name]
    .map(normalizeVehicleLookupValue)
    .filter(Boolean);
}

function uniqueExactVehicleMatch(vehicles, query) {
  const normalizedQuery = normalizeVehicleLookupValue(query);
  if (!normalizedQuery) return null;
  const matches = vehicles.filter((vehicle) => vehicleLookupValues(vehicle).includes(normalizedQuery));
  return matches.length === 1 ? matches[0] : null;
}

function defaultDetailSection(role, status, compact = false) {
  if (compact && ["waiting_office", "parts_requested"].includes(status)) return "chat";
  if (role === "mechanic") return "work";
  if (status === "open") return "team";
  return "work";
}

function defaultSupportingView(role, status) {
  if (role === "mechanic" || ["waiting_office", "parts_requested"].includes(status)) return "chat";
  return "preview";
}

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

export function App({ actor }) {
  const formRef = useRef(null);
  const previewRef = useRef(null);
  const previewGridRef = useRef(null);
  const mechanicLocationRefreshRef = useRef("");
  const mechanicProgressBackupRestoredRef = useRef("");
  const [workspace, setWorkspace] = useState(() => {
    if (typeof window === "undefined") return "mechanic";
    const params = new URLSearchParams(window.location.search);
    if ((actor.role === "office" || actor.role === "admin") && (params.has("workorder") || params.get("view") === "create")) return "generator";
    if (actor.role === "mechanic" && params.has("workorder")) return "generator";
    if (actor.role === "surveillance") return "surveillance";
    if (actor.role === "admin") return "admin";
    return actor.role === "mechanic" ? "mechanic" : "office";
  });
  const [mode, setMode] = useState(() => (actor.role === "mechanic" ? "mechanic" : "admin"));
  const [routeLoading, setRouteLoading] = useState(() => {
    if (typeof window === "undefined") return false;
    const params = new URLSearchParams(window.location.search);
    return params.has("workorder") || params.has("draft");
  });
  const [activeWorkorder, setActiveWorkorder] = useState(null);
  const [mechanicAction, setMechanicAction] = useState({ busy: "", message: "" });
  const [mechanicFinish, setMechanicFinish] = useState({ open: false, name: "", message: "" });
  const [officeCloseOpen, setOfficeCloseOpen] = useState(false);
  const [officeCloseNote, setOfficeCloseNote] = useState("");
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
      : window.matchMedia("(max-width: 1023px), (max-width: 1180px) and (orientation: portrait)").matches
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
    workStartDate: todayIso(),
    workEndDate: todayIso(),
  });
  const [officeDetailState, setOfficeDetailState] = useState({ busy: false, message: "" });
  const [vehicleLookup, setVehicleLookup] = useState({ loading: false, status: "", results: [] });
  const [selectedVehicle, setSelectedVehicle] = useState(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [officeLocations, setOfficeLocations] = useState([]);
  const [mapsConfig, setMapsConfig] = useState({});
  const [detailStatus, setDetailStatus] = useState("open");
  const [detailSource, setDetailSource] = useState(null);
  const [form, setForm] = useState({
    companyName: "",
    customerCompanyName: "",
    locationId: actor.locationIds?.[0] || "",
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
    mechanicName: "",
    startTime: "",
    endTime: "",
    managerName: "",
    officeNotes: "",
    customerSignature: "",
    authorizedBy: "",
    parts: [emptyPart(), emptyPart(), emptyPart()],
  });
  const workorderDraftPayload = useMemo(() => buildWorkorderDraftPayload({
    actor,
    form,
    mechanicUserIds: createAssignment.mechanicUserIds,
    selectedVehicle,
  }), [actor, createAssignment.mechanicUserIds, form, selectedVehicle]);
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
    { value: "mechanic_done", label: "Done" },
    { value: "closed", label: "Closed" },
    { value: "odoo_entered", label: "Odoo entered" },
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
    return [...officeNote, ...(activeWorkorder.messages || [])];
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
    workorderId: isMechanicDetail ? activeWorkorder?.workorder?.id : null,
    value: {
      diagnosis: form.diagnosis,
      workPerformed: form.workPerformed,
    },
    initialVersion: activeWorkorder?.workorder?.progressVersion || 1,
    saveProgress: updateMechanicProgress,
  });
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
  const detailLocationName = activeWorkorder?.workorder?.location?.name
    || officeLocations.find((entry) => entry.location.id === form.locationId)?.location?.name
    || "";
  const pendingPartCount = (activeWorkorder?.partRequests || []).filter((request) => !["approved", "rejected", "cancelled"].includes(request.status)).length;
  const visibleTimeline = useMemo(
    () => (activeWorkorder?.timeline || []).filter((event) => event.type !== "access"),
    [activeWorkorder?.timeline],
  );
  const detailSections = useMemo(() => {
    if (!activeWorkorder) return [];
    const common = [{ id: "work", label: isMechanicDetail ? "Work" : "Review" }];
    if (isCompact) {
      common.push({
        id: "chat",
        label: "Chat",
        count: conversationMessages.length || undefined,
        attention: ["waiting_office", "parts_requested"].includes(detailStatus),
      });
    }
    common.push(
      { id: "parts", label: "Parts", count: pendingPartCount || filledPartCount || undefined, attention: pendingPartCount > 0 },
      { id: "unit", label: form.unitType || "Unit" },
    );
    if (isOfficeDetail) common.push({ id: "team", label: "Team", count: assignedMechanicIds.length || undefined, attention: !assignedMechanicIds.length });
    common.push({ id: "activity", label: "Activity", count: visibleTimeline.length || undefined });
    return common;
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
    if (!isMechanicDetail || !activeWorkorder?.workorder?.id || !mechanicMapVehicle?.id) return;
    const refreshKey = `${activeWorkorder.workorder.id}:${mechanicMapVehicle.id}`;
    if (mechanicLocationRefreshRef.current === refreshKey) return;
    mechanicLocationRefreshRef.current = refreshKey;
    refreshVehicleLocation(mechanicMapVehicle);
  }, [activeWorkorder?.workorder?.id, isMechanicDetail, mechanicMapVehicle?.id]);
  useAutomaticRefresh(
    () => refreshVehicleLocation(mechanicMapVehicle),
    { enabled: workspace === "generator" && Boolean(mechanicMapVehicle?.id), intervalMs: 60_000 },
  );

  useEffect(() => {
    if (!["office", "admin"].includes(actor.role)) return;
    api("/api/office/template")
      .then(({ location, template, locations }) => {
        setOfficeLocations(locations || []);
        if (!location) return;
        setForm((current) => ({
          ...current,
          locationId: location.id,
          ...(template ? {
            headerTitle: template.header_title,
            brandTop: template.brand_top,
            brandBottom: template.brand_bottom,
            warrantyText: template.warranty_text,
            responsibilityText: template.responsibility_text,
            authorizationText: template.authorization_text,
          } : {}),
        }));
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
    if (activeWorkorder || !["office", "admin"].includes(actor.role) || !form.locationId) {
      setCreateAssignment((current) => ({ ...current, mechanics: [], loading: false }));
      return;
    }
    let cancelled = false;
    setCreateAssignment((current) => ({ ...current, mechanicUserIds: [], loading: true }));
    api(`/api/office/locations/${encodeURIComponent(form.locationId)}/mechanics`)
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
  }, [activeWorkorder, actor.role, form.locationId]);

  function selectOfficeLocation(locationId) {
    const selected = officeLocations.find((entry) => entry.location.id === locationId);
    if (!selected) return;
    clearOfficeCreateErrors("locationId");
    setForm((current) => ({
      ...current,
      locationId: selected.location.id,
      ...(selected.template ? {
        headerTitle: selected.template.header_title,
        brandTop: selected.template.brand_top,
        brandBottom: selected.template.brand_bottom,
        warrantyText: selected.template.warranty_text,
        responsibilityText: selected.template.responsibility_text,
        authorizationText: selected.template.authorization_text,
      } : {}),
    }));
  }

  useEffect(() => {
    api("/api/config")
      .then((result) => setMapsConfig(result.maps || {}))
      .catch(() => setMapsConfig({}));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
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
            window.history.replaceState({}, "", `${window.location.pathname}?view=drafts`);
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
        setForm((current) => workorderFormValues(detail, current));
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
    const params = new URLSearchParams(window.location.search);
    if (params.get("draft") === draftId) return;
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?view=create&draft=${encodeURIComponent(draftId)}`,
    );
  }, [activeWorkorder, workorderDraft.draft?.id, workspace]);

  useEffect(() => {
    const phoneQuery = window.matchMedia("(max-width: 700px)");
    const compactQuery = window.matchMedia("(max-width: 1023px), (max-width: 1180px) and (orientation: portrait)");
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
    setForm((current) => ({
      ...current,
      workDate: value,
      workStartDate: value,
      workEndDate: !current.workEndDate || current.workEndDate < value ? value : current.workEndDate,
    }));
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
    setForm((current) => ({ ...current, parts }));
  }

  async function saveActiveUsedParts(parts) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) throw new Error("Open a workorder before saving parts.");

    if (isOfficeDetail) {
      await api(`/api/office/workorders/${workorderId}`, {
        method: "PATCH",
        body: JSON.stringify({
          formData: {
            ...(activeWorkorder.workorder.formData || {}),
            parts,
          },
        }),
      });
    } else {
      const mechanicRows = parts.filter((part) => !part.requestId);
      await api(`/api/mechanic/workorders/${workorderId}/used-parts`, {
        method: "PATCH",
        body: JSON.stringify({ parts: mechanicRows }),
      });
    }

    setActiveWorkorder((current) => current ? {
      ...current,
      workorder: {
        ...current.workorder,
        formData: { ...(current.workorder.formData || {}), parts },
      },
    } : current);
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
    if (!vehicle?.id || locationLoading) return;
    const requestedVehicleId = vehicle.id;
    setLocationLoading(true);
    try {
      const result = await api(`/api/vehicles/${encodeURIComponent(vehicle.id)}/live-location`, { method: "POST" });
      setSelectedVehicle((current) => current?.id === requestedVehicleId ? result.vehicle : current);
    } catch (error) {
      setVehicleLookup((current) => ({ ...current, status: error.message }));
    } finally {
      setLocationLoading(false);
    }
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
    const savedParts = Array.isArray(savedForm.parts) && savedForm.parts.length
      ? savedForm.parts
      : [emptyPart(), emptyPart(), emptyPart()];
    const assignedMechanicName = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
      || workorder.mechanic?.name
      || (detail.user?.role === "mechanic" ? detail.user.name : "");

    return {
      ...current,
      ...savedForm,
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
      diagnosis: workorder.diagnosis || savedForm.diagnosis || "",
      workPerformed: workorder.workPerformed || savedForm.workPerformed || "",
      mechanicName: assignedMechanicName || savedForm.mechanicName,
      officeNotes: workorder.officeNotes || savedForm.officeNotes || "",
      parts: savedParts,
    };
  }

  function openOperationalWorkorder(detail) {
    const workorder = detail.workorder;
    const requestedSection = new URLSearchParams(window.location.search).get("section");
    const compactSections = ["work", "chat", "parts", "unit", "activity"];
    const nextSection = compactSections.includes(requestedSection)
      ? requestedSection
      : defaultDetailSection("mechanic", workorder.status, isCompact);
    mechanicLocationRefreshRef.current = "";
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
    const sectionQuery = nextSection === "work" ? "" : `&section=${encodeURIComponent(nextSection)}`;
    window.history.replaceState({}, "", `${window.location.pathname}?workorder=${encodeURIComponent(workorder.id)}${sectionQuery}`);
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
      setForm((current) => workorderFormValues(detail, current));
      setWorkspace("generator");
      setOfficeDetailState({ busy: false, message: "" });
      window.history.replaceState({}, "", `${window.location.pathname}?workorder=${encodeURIComponent(workorder.id)}`);
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
      return false;
    }
  }

  async function saveOfficeWorkorder() {
    if (!activeWorkorder?.workorder || !isOfficeDetail) return;
    setOfficeDetailState({ busy: true, message: "Saving..." });
    try {
      const formData = {
        ...(activeWorkorder.workorder.formData || {}),
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
      const result = await api(`/api/office/workorders/${activeWorkorder.workorder.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          assetId: selectedVehicle?.id || activeWorkorder.workorder.asset?.id || null,
          locationId: form.locationId || activeWorkorder.workorder.locationId || null,
          concern: form.mechanicConcern,
          officeNotes: form.officeNotes || "",
          formData,
        }),
      });
      const detail = await api(`/api/office/workorders/${result.workorder.id}`);
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => workorderFormValues(detail, current));
      setOfficeDetailState({ busy: false, message: "Saved. Mechanic view will update from this record." });
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
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
    createInitialDatesRef.current = {
      workStartDate: createDate,
      workEndDate: createDate,
    };
    workorderDraft.reset(null);
    setResumedDraft(null);
    setDraftLeaveOpen(false);
    setActiveWorkorder(null);
    setSelectedVehicle(null);
    setVehicleLookup({ loading: false, status: "", results: [] });
    setForm((current) => ({
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
      mechanicName: "",
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
    }));
    setPreviewPanelOpen(true);
    setDetailSource(null);
    setMode("admin");
    setOfficeCreateErrors({});
    setOfficeCreateState({ busy: false, message: "" });
    setCreateAssignment((current) => ({ ...current, mechanicUserIds: [] }));
    setWorkspace("generator");
    window.history.replaceState({}, "", `${window.location.pathname}?view=create`);
  }

  function finishOpenOfficeWorkspace() {
    setDraftLeaveOpen(false);
    setDraftLeaveBusy(false);
    setActiveWorkorder(null);
    setSelectedVehicle(null);
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace(actor.role === "admin" ? "admin" : "office");
    window.history.replaceState({}, "", window.location.pathname);
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
    window.history.replaceState(
      {},
      "",
      `${window.location.pathname}?view=create&draft=${encodeURIComponent(draft.id)}`,
    );
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
    returnToMyWork();
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
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace("mechanic");
    window.history.replaceState({}, "", window.location.pathname);
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

  async function sendWorkorderChat({ body, attachment }) {
    const workorderId = activeWorkorder?.workorder?.id;
    if ((!body && !attachment) || !workorderId) return false;

    setMechanicAction({ busy: "chat", message: "" });
    try {
      const rolePath = isOfficeDetail ? "office" : "mechanic";
      await api(`/api/${rolePath}/workorders/${workorderId}/messages`, {
        method: "POST",
        body: JSON.stringify({ body, ...(attachment ? { attachment } : {}) }),
      });
      await reloadActiveWorkorder();
      setMechanicAction({ busy: "", message: "Message sent." });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: error.message });
      return false;
    }
  }

  async function reloadActiveWorkorder() {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) return;
    const detail = isOfficeDetail
      ? await api(`/api/office/workorders/${encodeURIComponent(workorderId)}`)
      : await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`);
    setActiveWorkorder(detail);
    setDetailStatus(detail.workorder.status);
    setForm((current) => workorderFormValues(detail, current));
  }

  useEffect(() => {
    if (mode !== "mechanic" || !activeWorkorder?.workorder?.id) return undefined;
    const workorderId = activeWorkorder.workorder.id;
    let cancelled = false;
    const refreshDetail = async () => {
      try {
        const detail = await api(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}`);
        if (cancelled) return;
        setActiveWorkorder(detail);
        setDetailStatus(detail.workorder.status);
        if (!mechanicProgress.hasUnsyncedChanges && mechanicProgress.status !== "saving") {
          setForm((current) => workorderFormValues(detail, current));
        }
      } catch {
        // Keep the current detail visible; dashboard refresh handles missing workorders.
      }
    };
    const interval = window.setInterval(refreshDetail, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [
    activeWorkorder?.workorder?.id,
    mechanicProgress.hasUnsyncedChanges,
    mechanicProgress.status,
    mode,
  ]);

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
        message: "Add the work performed before finishing this workorder.",
      }));
      return;
    }
    if (!mechanicFinishNameMatches) {
      setMechanicFinish((current) => ({
        ...current,
        message: `Write ${expectedMechanicName} to finish this workorder.`,
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
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}?workorder=${encodeURIComponent(activeWorkorder.workorder.id)}&section=chat`,
        );
      }
      return;
    }
    setDetailSection(section);
    if (isMechanicDetail && activeWorkorder?.workorder?.id) {
      const sectionQuery = section === "work" ? "" : `&section=${encodeURIComponent(section)}`;
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?workorder=${encodeURIComponent(activeWorkorder.workorder.id)}${sectionQuery}`,
      );
    }
  }

  function openFullscreenPreview() {
    setPrintMenuOpen(false);
    setFullscreenPageIndex(0);
    setFullscreenZoom(isPhone ? 0 : 1);
    setPreviewFullscreen(true);
  }

  const workorderChatContent = activeWorkorder ? (
    <div id={isMechanicDetail ? "mechanic-chat-section" : undefined} className="chat-content">
      <ChatThread messages={conversationMessages} currentRole={isOfficeDetail ? "office" : "mechanic"} currentUserId={actor.id} />
      <ChatComposer
        onSend={sendWorkorderChat}
        disabled={isMechanicDetail && !activeWorkorder.allowedActions.sendMessage}
        sending={mechanicAction.busy === "chat"}
        placeholder={isOfficeDetail ? "Message mechanic..." : "Type a message to office..."}
        textareaLabel={isOfficeDetail ? "Message mechanic" : "Message office"}
        cameraLabel={isOfficeDetail ? "Take or add photo" : "Take photo"}
        sendLabel="Send"
        compact={isMechanicDetail}
      />
      {mechanicAction.message ? <p className="mechanic-action-message" role="status">{mechanicAction.message}</p> : null}
    </div>
  ) : null;

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
    return <MechanicWorkspace actor={actor} onOpenWorkorder={openOperationalWorkorder} />;
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

  return (
    <main className={`prototype ${isWorkorderDetail ? "workorder-detail-page" : ""} ${isMechanicDetail ? "mechanic-detail-page" : ""}`.trim()}>
      <style>{workorderTemplateStyles}</style>
      <BrowserPrintDocument payload={browserPrintPayload} />
      <WorkorderDetailLayout detail={isWorkorderDetail} previewOpen={showEmbeddedPreview}>
        <aside className="control-panel" ref={formRef}>
          {activeWorkorder ? (
            <div className="detail-context-bar">
              <button
                type="button"
                onClick={returnToRoleWorkspace}
                aria-label={actor.role === "admin" ? "Back to Operations" : isOfficeDetail ? "Back to Office" : "Back to My Work"}
                title={actor.role === "admin" ? "Back to Operations" : isOfficeDetail ? "Back to Office" : "Back to My Work"}
              >
                <ArrowLeft />
              </button>
              <div>
                <strong>{activeWorkorder.workorder.asset?.unitNo || activeWorkorder.workorder.asset?.name || "Workorder"}</strong>
                <span>{activeWorkorder.workorder.serial}</span>
              </div>
              <div className="detail-context-actions">
                <WorkorderStatusPill status={detailStatus} label={currentStatusLabel} />
                {isOfficeDetail ? (
                  <button
                    className="detail-save-button"
                    type="button"
                    onClick={saveOfficeWorkorder}
                    disabled={officeDetailState.busy}
                    aria-label={officeDetailState.busy ? "Saving workorder" : "Save workorder"}
                    title={officeDetailState.busy ? "Saving workorder" : "Save workorder"}
                  >
                    <Save01 />
                  </button>
                ) : null}
                {isOfficeDetail && detailStatus === "mechanic_done" ? (
                  <button
                    className="detail-close-workorder-button"
                    type="button"
                    onClick={() => {
                      setOfficeDetailState((current) => ({ ...current, message: "" }));
                      setOfficeCloseOpen(true);
                    }}
                    disabled={officeDetailState.busy}
                    aria-label="Approve workorder"
                    title="Approve workorder"
                  >
                    <CheckCircle />
                    <span>Approve</span>
                  </button>
                ) : null}
                <PreviewToggle
                  open={showEmbeddedPreview || previewFullscreen}
                  onToggle={toggleWorkorderTools}
                  controls="workorder-preview-panel"
                  openLabel="Open workorder tools"
                  closeLabel="Close workorder tools"
                />
              </div>
            </div>
          ) : (
            <div className="detail-context-bar office-create-nav">
              <button
                type="button"
                onClick={openOfficeWorkspace}
                aria-label={actor.role === "admin" ? "Back to Operations" : "Back to Office"}
                title={actor.role === "admin" ? "Back to Operations" : "Back to Office"}
              >
                <ArrowLeft />
              </button>
              <div>
                <strong>Create workorder</strong>
                <DraftSaveStatus
                  status={workorderDraft.status}
                  error={workorderDraft.error}
                  labels={{ dirty: "Draft changed" }}
                  className="office-create-draft-status"
                />
              </div>
              <div className="detail-context-actions">
                <button
                  className="detail-create-button"
                  type="submit"
                  form={CREATE_WORKORDER_FORM_ID}
                  disabled={officeCreateState.busy}
                >
                  <Plus />
                  <span>{officeCreateState.busy ? "Creating..." : "Create"}</span>
                </button>
                <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" />
              </div>
            </div>
          )}

          {!isMechanicDetail ? (
            <div className="mobile-jumpbar" aria-label="Phone shortcuts">
              <button type="button" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Form
              </button>
              <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" className="mobile-preview-pane-toggle" />
            </div>
          ) : null}

          {activeWorkorder ? (
            <>
              <WorkorderObjectSummary
                concern={form.mechanicConcern}
                customer={form.customerCompanyName}
                dates={workDateRangeLabel(form)}
                location={detailLocationName}
                mechanics={detailMechanicNames}
                unit={form.unitNo || mechanicAsset.unitNo || mechanicAsset.name}
                unitType={form.unitType || mechanicAsset.unitType || "Unit"}
                actions={isMechanicDetail && !isCompact ? (
                  <button
                    className="finish-work-button"
                    type="button"
                    onClick={() => setMechanicFinish({ open: true, name: "", message: "" })}
                    disabled={!activeWorkorder?.allowedActions.markDone || Boolean(mechanicAction.busy)}
                  >
                    <CheckCircle />
                    <span>{mechanicAction.busy === "done" ? "Finishing" : "Finish work"}</span>
                  </button>
                ) : null}
              >
                {isMechanicDetail ? (
                  <div className="workorder-object-inline-detail">
                    <span>{mechanicUnitType} details</span>
                    <strong>{mechanicVehicleLabel}</strong>
                    <span>Mileage</span>
                    <strong>{form.mileage ? `${form.mileage} mi` : "Not listed"}</strong>
                  </div>
                ) : null}
                {mechanicAction.message ? <p className="mechanic-action-message" role="status">{mechanicAction.message}</p> : null}
              </WorkorderObjectSummary>
              <WorkorderSectionNav sections={detailSections} activeSection={detailSection} onSelect={selectDetailSection} />
              {isMechanicDetail && isCompact ? (
                <div className="mechanic-compact-primary-action">
                  <button
                    className="finish-work-button"
                    type="button"
                    onClick={() => setMechanicFinish({ open: true, name: "", message: "" })}
                    disabled={!activeWorkorder?.allowedActions.markDone || Boolean(mechanicAction.busy)}
                  >
                    <CheckCircle />
                    <span>{mechanicAction.busy === "done" ? "Finishing" : "Finish work"}</span>
                  </button>
                </div>
              ) : null}
            </>
          ) : null}

          {!activeWorkorder ? (
            <CreateWorkorderForm
              assignment={createAssignment}
              busy={officeCreateState.busy}
              errors={officeCreateErrors}
              errorFocusKey={officeCreateAttempt}
              form={form}
              locations={officeLocations}
              message={officeCreateState.message}
              onAddPart={addPartRow}
              onAssignmentChange={(mechanicUserIds) => setCreateAssignment((current) => ({ ...current, mechanicUserIds }))}
              onFieldChange={updateField}
              onLocationChange={selectOfficeLocation}
              onPartChange={updatePart}
              onRemovePart={removePartRow}
              onSubmit={createOfficeWorkorder}
              onUnitChange={updateUnitNumber}
              onVehicleSelect={applyVehicle}
              mapsConfig={mapsConfig}
              selectedVehicle={selectedVehicle}
              vehicleLookup={vehicleLookup}
            />
          ) : (
          <div className="accordion-stack workorder-progressive-stack">
            {activeWorkorder && isCompact ? (
              <ProgressiveWorkorderSection
                id="chat"
                title={isOfficeDetail ? "Chat with mechanic" : "Messages with office"}
                summary={`${conversationMessages.length} ${conversationMessages.length === 1 ? "message" : "messages"}`}
                activeSection={detailSection}
                onSelect={setDetailSection}
                attention={["waiting_office", "parts_requested"].includes(detailStatus)}
                className="chat-section"
                displayMode={isMechanicDetail ? "panel" : "accordion"}
              >
                {workorderChatContent}
              </ProgressiveWorkorderSection>
            ) : null}

            {isMechanicDetail ? (
              <ProgressiveWorkorderSection
                id="work"
                title="Work performed"
                summary={form.workPerformed ? "Repair details added" : "Diagnosis and repair details"}
                activeSection={detailSection}
                onSelect={setDetailSection}
                className="mechanic-work-section"
                displayMode="panel"
              >
                <div className="operational-form detail-workflow-fields">
                  <OperationalFormField id="mechanic-diagnosis" label="Diagnosis" hint="What did you inspect or find?">
                    <textarea rows="3" value={form.diagnosis} onChange={(event) => updateField("diagnosis", event.target.value)} />
                  </OperationalFormField>
                  <OperationalFormField id="mechanic-work-performed" label="Repair completed" hint="Write what was repaired, replaced, adjusted, or checked.">
                    <textarea rows="4" value={form.workPerformed} onChange={(event) => updateField("workPerformed", event.target.value)} />
                  </OperationalFormField>
                  <MechanicProgressStatus status={mechanicProgress.status} error={mechanicProgress.error} />
                  <Button type="button" variant="secondary" onClick={saveMechanicWorkNotes} disabled={Boolean(mechanicAction.busy)}>
                    {mechanicAction.busy === "notes" ? "Saving..." : "Save progress"}
                  </Button>
                </div>
              </ProgressiveWorkorderSection>
            ) : null}

            {isOfficeDetail ? (
              <ProgressiveWorkorderSection
                id="work"
                title={detailStatus === "mechanic_done" ? "Review completed work" : "Work review"}
                summary={officeDetailState.message || (form.workPerformed ? "Mechanic details available" : "Office notes and repair progress")}
                activeSection={detailSection}
                onSelect={setDetailSection}
                attention={detailStatus === "mechanic_done"}
              >
                <div className="workorder-review-content">
                  <div className="workorder-review-copy">
                    <div><span>Diagnosis</span><p>{form.diagnosis || "No diagnosis recorded yet."}</p></div>
                    <div><span>Work performed</span><p>{form.workPerformed || "No completed work recorded yet."}</p></div>
                  </div>
                  <Field label="Office notes">
                    <textarea value={form.officeNotes} onChange={(event) => updateField("officeNotes", event.target.value)} rows="3" />
                  </Field>
                  <Button variant="primary" onClick={saveOfficeWorkorder} disabled={officeDetailState.busy}>
                    {officeDetailState.busy ? "Saving" : "Save changes"}
                  </Button>
                  {officeDetailState.message ? <p className="mechanic-action-message" role="status">{officeDetailState.message}</p> : null}
                </div>
              </ProgressiveWorkorderSection>
            ) : null}

            <ProgressiveWorkorderSection
              id="parts"
              title={isMechanicDetail ? "Parts used" : "Parts"}
              summary={pendingPartCount ? `${pendingPartCount} awaiting action` : `${filledPartCount} recorded`}
              activeSection={detailSection}
              onSelect={setDetailSection}
              attention={pendingPartCount > 0}
              displayMode={isMechanicDetail ? "panel" : "accordion"}
            >
              <div id={isMechanicDetail ? "mechanic-parts-section" : undefined}>
                {activeWorkorder ? (
                  <PartRequestsPanel
                    role={isOfficeDetail ? "office" : "mechanic"}
                    detail={activeWorkorder}
                    parts={form.parts}
                    onPartsChange={updateActiveUsedParts}
                    onSaveParts={saveActiveUsedParts}
                    onChanged={reloadActiveWorkorder}
                  />
                ) : (
                  <>
                    <div className="parts-editor">
                      <div className="part-row part-row-head">
                        <span>S.No</span>
                        <span>Part no.</span>
                        <span>Qty</span>
                        <span>Repair order</span>
                        <span></span>
                      </div>
                      {form.parts.map((part, index) => (
                        <div className="part-row" key={index}>
                          <strong>{index + 1}</strong>
                          <input value={part.partNo} onChange={(event) => updatePart(index, "partNo", event.target.value)} aria-label={`Part number ${index + 1}`} placeholder="Part no." />
                          <input value={part.qty} onChange={(event) => updatePart(index, "qty", event.target.value)} aria-label={`Quantity ${index + 1}`} placeholder="Qty" />
                          <input value={part.repairOrder} onChange={(event) => updatePart(index, "repairOrder", event.target.value)} aria-label={`Repair order ${index + 1}`} placeholder="Repair order" />
                          <button className="remove-row" type="button" onClick={() => removePartRow(index)} disabled={form.parts.length <= 1}>
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <Button onClick={addPartRow}>Add part row</Button>
                  </>
                )}
              </div>
            </ProgressiveWorkorderSection>

            {isOfficeDetail ? (
            <>
            <ProgressiveWorkorderSection
              id="unit"
              title={`${form.unitType || "Unit"} details`}
              summary={[form.unitNo, form.customerCompanyName].filter(Boolean).join(" · ") || "Unit and customer information"}
              activeSection={detailSection}
              onSelect={setDetailSection}
            >
              <div className="workorder-unit-content">
                {officeLocations.length ? (
                  <Field label="Location">
                    <select value={form.locationId} onChange={(event) => selectOfficeLocation(event.target.value)}>
                      {officeLocations.map((entry) => <option key={entry.location.id} value={entry.location.id}>{entry.location.name}</option>)}
                    </select>
                  </Field>
                ) : null}
                <div className="two-col">
                  <div className="unit-field-wrap">
                    <label className="field">
                      <span className="field-label-row">
                        Unit no.
                        <button
                          className="help-dot"
                          type="button"
                          aria-label="Unit lookup help"
                          title="Type a unit, truck name, VIN, or plate. Choose a Samsara match to fill VIN, mileage, license, and model."
                        >
                          ?
                        </button>
                      </span>
                      <input
                        aria-label="Unit no."
                        aria-autocomplete="list"
                        aria-controls="vehicle-suggestions"
                        aria-expanded={vehicleLookup.results.length > 0}
                        role="combobox"
                        value={form.unitNo}
                        onChange={(event) => updateUnitNumber(event.target.value)}
                        autoComplete="off"
                      />
                    </label>
                    {vehicleLookup.loading ? <p className="vehicle-inline-status">Searching...</p> : null}
                    {vehicleLookup.results.length ? (
                      <div className="vehicle-results" id="vehicle-suggestions" role="listbox" aria-label="Vehicle suggestions">
	                        {vehicleLookup.results.map((vehicle) => (
	                          <button type="button" role="option" aria-selected="false" key={vehicle.id} onClick={() => applyVehicle(vehicle)}>
	                            <strong>{vehicle.unit_no || vehicle.name || vehicle.vin || "Unnamed vehicle"}</strong>
	                            <span>
	                              {[vehicle.unit_type, vehicle.owner_name, vehicleModelText(vehicle), vehicle.vin, vehicle.license_plate, vehicleMileage(vehicle) ? `${vehicleMileage(vehicle)} mi` : "", getVehicleLocation(vehicle) ? "Map" : ""].filter(Boolean).join(" / ")}
	                            </span>
	                          </button>
	                        ))}
	                      </div>
	                    ) : null}
                  </div>
                </div>
                <div className="two-col">
                  <Field label="Start date">
                    <input type="date" value={form.workStartDate} onChange={(event) => updateStartDate(event.target.value)} />
                  </Field>
                  <Field label="End date">
                    <input type="date" value={form.workEndDate} min={form.workStartDate || undefined} onChange={(event) => updateField("workEndDate", event.target.value)} />
                  </Field>
                </div>
                <div className="two-col">
                  <Field label="Unit type">
                    <select value={form.unitType} onChange={(event) => updateField("unitType", event.target.value)}>
                      <option value="">Select type</option>
                      <option value="Truck">Truck</option>
                      <option value="Trailer">Trailer</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                  <Field label="License">
                    <input value={form.licenseNo} onChange={(event) => updateField("licenseNo", event.target.value)} />
                  </Field>
                </div>
	                <div className="two-col">
                  <Field label="Mileage">
                    <input value={form.mileage} onChange={(event) => updateField("mileage", event.target.value)} />
                  </Field>
	                  <Field label="Model">
	                    <input value={form.model} onChange={(event) => updateField("model", event.target.value)} />
	                  </Field>
                </div>
                <div className="two-col">
                  <Field label="Customer company">
                    <input value={form.customerCompanyName} onChange={(event) => updateField("customerCompanyName", event.target.value)} />
                  </Field>
                  <Field label="VIN no.">
                    <input value={form.vinNo} onChange={(event) => updateField("vinNo", event.target.value)} />
                  </Field>
                </div>
                <AssetLocationCard
                  vehicle={selectedVehicle}
                  location={getVehicleLocation(selectedVehicle)}
                  mapsConfig={mapsConfig}
                />
                <Field label="Mechanic concern">
                  <input value={form.mechanicConcern} onChange={(event) => updateField("mechanicConcern", event.target.value)} />
                </Field>
              </div>
            </ProgressiveWorkorderSection>

            <ProgressiveWorkorderSection
              id="team"
              title="Mechanics"
              summary={detailMechanicNames || "Unassigned"}
              activeSection={detailSection}
              onSelect={setDetailSection}
              attention={!assignedMechanicIds.length}
            >
              <div className="workorder-team-content">
                {isOfficeDetail && !["closed", "odoo_entered"].includes(detailStatus) ? (
                  <div className="office-assignment-control">
                    <fieldset className="office-mechanic-team">
                      <legend>Assigned mechanics</legend>
                      {(activeWorkorder.assignableMechanics || []).map((mechanic) => {
                        const checked = officeAssignment.mechanicUserIds.includes(mechanic.id);
                        return (
                          <label key={mechanic.id}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => setOfficeAssignment((current) => ({
                                ...current,
                                mechanicUserIds: checked
                                  ? current.mechanicUserIds.filter((id) => id !== mechanic.id)
                                  : [...current.mechanicUserIds, mechanic.id],
                              }))}
                            />
                            <span>{mechanic.name}</span>
                          </label>
                        );
                      })}
                      {!(activeWorkorder.assignableMechanics || []).length ? <p>No mechanics assigned to this location.</p> : null}
                    </fieldset>
                    <Field label="Assignment reason">
                      <input
                        aria-label="Assignment reason"
                        value={officeAssignment.reason}
                        onChange={(event) => setOfficeAssignment((current) => ({ ...current, reason: event.target.value }))}
                        placeholder="Why is the team changing?"
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={officeDetailState.busy || !officeAssignmentChanged}
                      onClick={updateOfficeMechanicTeam}
                    >
                      Update team
                    </Button>
                  </div>
                ) : null}
                <Field label="Mechanic name">
                  <input value={form.mechanicName} onChange={(event) => updateField("mechanicName", event.target.value)} />
                </Field>
                <div className="two-col">
                  <Field label="Start time">
                    <input type="time" value={form.startTime} onChange={(event) => updateField("startTime", event.target.value)} />
                  </Field>
                  <Field label="End time">
                    <input type="time" value={form.endTime} onChange={(event) => updateField("endTime", event.target.value)} />
                  </Field>
                </div>
                <div className="two-col">
                  <Field label="Customer sign">
                    <input value={form.customerSignature} onChange={(event) => updateField("customerSignature", event.target.value)} />
                  </Field>
                  <Field label="Authorized by">
                    <input value={form.authorizedBy} onChange={(event) => updateField("authorizedBy", event.target.value)} />
                  </Field>
                </div>
              </div>
            </ProgressiveWorkorderSection>
            </>
            ) : (
              <ProgressiveWorkorderSection
                id="unit"
                title={`${mechanicUnitType} details`}
                summary={[form.unitNo, form.model].filter(Boolean).join(" · ") || "Unit information"}
                activeSection={detailSection}
                onSelect={setDetailSection}
                displayMode="panel"
              >
                <dl className="workorder-readonly-details">
                  <div><dt>Unit</dt><dd>{form.unitNo || "Not listed"}</dd></div>
                  <div><dt>Model</dt><dd>{mechanicVehicleLabel}</dd></div>
                  <div><dt>Mileage</dt><dd>{form.mileage ? `${form.mileage} mi` : "Not listed"}</dd></div>
                  <div><dt>VIN</dt><dd>{form.vinNo || "Not listed"}</dd></div>
                  <div><dt>License</dt><dd>{form.licenseNo || "Not listed"}</dd></div>
                  <div><dt>Customer</dt><dd>{form.customerCompanyName || "Not listed"}</dd></div>
                  <div><dt>Work dates</dt><dd>{workDateRangeLabel(form) || "Not listed"}</dd></div>
                  <div><dt>Workorder</dt><dd>{activeWorkorder.workorder.serial}</dd></div>
                </dl>
                <AssetLocationCard
                  vehicle={mechanicMapVehicle}
                  location={mechanicMapLocation}
                  mapsConfig={mapsConfig}
                  showVehicleLabel={false}
                />
              </ProgressiveWorkorderSection>
            )}

            {activeWorkorder ? (
              <ProgressiveWorkorderSection
                id="activity"
                title="Activity"
                summary={`${visibleTimeline.length} events`}
                activeSection={detailSection}
                onSelect={setDetailSection}
                className="is-detail-end-timeline"
                displayMode={isMechanicDetail ? "panel" : "accordion"}
              >
                <WorkorderTimelinePanel
                  timeline={visibleTimeline}
                  participants={activeWorkorder.participants || []}
                  className="is-control-timeline"
                />
              </ProgressiveWorkorderSection>
            ) : null}
          </div>
          )}
        </aside>

        <PreviewPane
          id="workorder-preview-panel"
          open={showEmbeddedPreview}
          variant={isWorkorderDetail ? "dock" : "full"}
          panelRef={previewRef}
          status={activeWorkorder ? <WorkorderStatusPill status={detailStatus} label={currentStatusLabel} /> : null}
          countLabel={workorderCountLabel}
          range={range}
          printMenuOpen={printMenuOpen}
          onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
          onPrint={canPrint && activeWorkorder ? () => {
            setPrintMenuOpen(false);
            printWorkorders();
          } : undefined}
          primaryActionLabel={primaryActionLabel}
          onFullscreen={openFullscreenPreview}
          onOpenPreview={isWorkorderDetail ? openFullscreenPreview : undefined}
          supportingContent={!isCompact && activeWorkorder ? workorderChatContent : undefined}
          supportingLabel={isOfficeDetail ? "Chat with mechanic" : "Chat with office"}
          supportingCount={conversationMessages.length || undefined}
          supportingAttention={["waiting_office", "parts_requested"].includes(detailStatus)}
          activeView={supportingView}
          onViewChange={setSupportingView}
        >
          <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""} ${activeWorkorder ? "mechanic-preview-grid" : ""}`}>
            <WorkorderPreview label="First page" serial={firstSerial} form={form} />
            {effectiveCopies > 1 || lastPhysicalPageIndex > 0
              ? <WorkorderPreview label="Last page" serial={lastSerial} form={form} pageIndex={lastPhysicalPageIndex} />
              : null}
          </div>
        </PreviewPane>
      </WorkorderDetailLayout>

      <PreviewFullscreen
        open={previewFullscreen}
        form={form}
        serials={previewSerials}
        pageIndex={fullscreenPageIndex}
        zoom={fullscreenZoom}
        range={range}
        countLabel={workorderCountLabel}
        actionLabel={primaryActionLabel}
        onClose={() => setPreviewFullscreen(false)}
        onPageChange={setFullscreenPageIndex}
        onZoomChange={setFullscreenZoom}
        onPrint={canPrint && activeWorkorder ? () => {
          setPreviewFullscreen(false);
          printWorkorders();
        } : undefined}
      />
      <PrintModal state={printState} range={range} onClose={() => setPrintState({ open: false, stage: "idle", message: "" })} />
      <DraftLeaveDialog
        open={draftLeaveOpen}
        busy={draftLeaveBusy}
        status={workorderDraft.status}
        error={workorderDraft.error}
        onStay={() => setDraftLeaveOpen(false)}
        onDiscard={discardDraftAndLeave}
        onSaveAndLeave={saveDraftAndLeave}
      />
      {mechanicFinish.open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mechanicAction.busy) {
              setMechanicFinish({ open: false, name: "", message: "" });
            }
          }}
        >
          <form className="mechanic-completion-modal" role="dialog" aria-modal="true" aria-label="Finish workorder" onSubmit={submitMechanicFinish}>
            <button
              className="close-button"
              type="button"
              onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
              disabled={Boolean(mechanicAction.busy)}
              aria-label="Cancel finishing workorder"
            >
              <XClose />
            </button>
            <h2>Finish workorder?</h2>
            <p>This sends the workorder to office for review. Write your name to confirm.</p>
            <Field label={`Write "${expectedMechanicName}"`}>
              <input
                type="text"
                value={mechanicFinish.name}
                onChange={(event) => setMechanicFinish({ open: true, name: event.target.value, message: "" })}
                placeholder={expectedMechanicName}
                autoComplete="off"
                autoFocus
              />
            </Field>
            {mechanicFinish.message ? <p className="mechanic-completion-message" role="alert">{mechanicFinish.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
                disabled={Boolean(mechanicAction.busy)}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!mechanicFinishNameMatches || Boolean(mechanicAction.busy)}>
                {mechanicAction.busy === "done" ? "Finishing..." : "Finish workorder"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
      {officeCloseOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOfficeCloseOpen(false)}>
          <form className="office-close-modal" role="dialog" aria-modal="true" aria-label="Approve workorder" onSubmit={closeOfficeWorkorder}>
            <button className="close-button" type="button" onClick={() => setOfficeCloseOpen(false)} aria-label="Close review"><XClose /></button>
            <h2>Approve workorder?</h2>
            <p className="office-close-modal-copy">This sends the completed workorder to the surveillance team's Odoo queue.</p>
            <Field label="Approval note (optional)">
              <textarea rows="3" value={officeCloseNote} onChange={(event) => setOfficeCloseNote(event.target.value)} placeholder="Add an approval note" />
            </Field>
            {officeDetailState.message ? <p className="mechanic-completion-message" role="status">{officeDetailState.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button variant="secondary" type="button" onClick={() => setOfficeCloseOpen(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={officeDetailState.busy}>{officeDetailState.busy ? "Approving..." : "Approve workorder"}</Button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

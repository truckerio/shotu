import { useCallback, useMemo, useRef, useState } from "react";
import { readInitialWorkspace, replaceRouteSearch, routeStartsLoading } from "./route-state.js";
import { roleCapabilities } from "./role-capabilities.js";
import { activeWorkorderCompanyId, activeWorkorderModulePolicy, canOpenCreateWorkspaceForActor } from "./role-router-module-access.js";
import { useRoleRouteNavigation } from "./useRoleRouteNavigation.js";
import { useRoleRouterFormController } from "./useRoleRouterFormController.js";
import { useRoleRouterCommands } from "./useRoleRouterCommands.js";
import { useRoleRouterLifecycleEffects } from "./useRoleRouterLifecycleEffects.js";
import { RoleWorkspaceOutlet } from "./RoleWorkspaceOutlet.jsx";
import { useInitialRoleRouteHydration, useWorkorderDetailRoute } from "./useWorkorderDetailRoute.js";
import { useWorkorderDetailViewModel } from "./useWorkorderDetailViewModel.js";
import { updateDetailDiagnosisRepair } from "./role-router-api.js";
import {
  createDraftBaselineFromForm,
  createInitialDraftBaseline,
  createInitialWorkorderForm,
  workorderFormValues,
} from "./role-router-model.js";
import { vehicleMileage, vehicleModelText } from "../../features/create-workorder/vehicle-lookup-model.js";
import { useVehicleLookupController } from "../../features/create-workorder/useVehicleLookupController.js";
import { useWorkorderDraftLifecycle } from "../../features/create-workorder/useWorkorderDraftLifecycle.js";
import { useCreateLocationController } from "../../features/create-workorder/useCreateLocationController.js";
import { useWorkorderPrintController } from "../../features/create-workorder/useWorkorderPrintController.js";
import { useMechanicWorkorderActions } from "../../features/mechanic/useMechanicWorkorderActions.js";
import { useMechanicProgress } from "../../features/mechanic/progress/useMechanicProgress.js";
import { useOfficeWorkorderActions } from "../../features/office/useOfficeWorkorderActions.js";
import { loadWorkorderDetail } from "../../features/workorder-detail/workorder-detail-loader.js";
import { useWorkorderPreviewController } from "../../features/workorder-detail/useWorkorderPreviewController.js";
import { clearOfficeWorkorderEditBackup, writeOfficeWorkorderEditBackup } from "../../features/workorder-detail/office-workorder-autosave-storage.js";
import { useWorkorderPreferences } from "../../hooks/useWorkorderPreferences.js";
import { normalizeLocale } from "../../i18n/index.js";
import { api } from "../../lib/api.js";
import { workorderPhysicalPageCount } from "../../../../shared/workorder-template.js";
export function RoleRouter({ actor }) {
  const capabilities = roleCapabilities(actor.role);
  const formRef = useRef(null);
  const previewRef = useRef(null);
  const previewGridRef = useRef(null);
  const mechanicProgressBackupRestoredRef = useRef("");
  const officeActionsRef = useRef(null);
  const [workspace, setWorkspace] = useState(() => readInitialWorkspace(actor));
  const [mode, setMode] = useState(capabilities.createMode);
  const [routeLoading, setRouteLoading] = useState(routeStartsLoading);
  const [activeWorkorder, setActiveWorkorder] = useState(null);
  const [mechanicAction, setMechanicAction] = useState({ busy: "", message: "" });
  const [mechanicFinish, setMechanicFinish] = useState({ open: false, name: "", message: "" });
  const [officeCloseOpen, setOfficeCloseOpen] = useState(false);
  const [officeCloseNote, setOfficeCloseNote] = useState("");
  const [officeReturn, setOfficeReturn] = useState({ open: false, reason: "", categories: [], message: "" });
  const [officeCancel, setOfficeCancel] = useState({ open: false, reason: "", message: "" });
  const [officeAssignment, setOfficeAssignment] = useState({ mechanicUserIds: [], reason: "" });
  const [detailSection, setDetailSection] = useState("work");
  const [officeCreateState, setOfficeCreateState] = useState({ busy: false, message: "" });
  const [officeCreateErrors, setOfficeCreateErrors] = useState({});
  const [officeCreateAttempt, setOfficeCreateAttempt] = useState(0);
  const interfacePreferences = useWorkorderPreferences("mechanic-interface");
  const interfaceLocale = normalizeLocale(interfacePreferences.preferences.locale);
  const createInitialDatesRef = useRef(createInitialDraftBaseline(actor));
  const [officeDetailState, setOfficeDetailState] = useState({ busy: false, message: "" });
  const [usedPartsDirty, setUsedPartsDirty] = useState(false);
  const [mapsConfig, setMapsConfig] = useState({});
  const [detailStatus, setDetailStatus] = useState("open");
  const [detailSource, setDetailSource] = useState(null);
  const [form, setForm] = useState(() => createInitialWorkorderForm(actor));
  const effectiveCopies = 1;
  const firstSerial = activeWorkorder?.workorder?.serial || "DRAFT";
  const previewSerials = useMemo(() => [firstSerial], [firstSerial]);
  const lastSerial = firstSerial;
  const range = firstSerial;
  const workorderCountLabel = activeWorkorder ? "1 workorder" : "Draft workorder";
  const lastPhysicalPageIndex = workorderPhysicalPageCount(form) - 1;
  const primaryActionLabel = "Print workorder";
  const canPrint = capabilities.canPrintWorkorder;
  const {
    browserPrintPayload,
    printMenuOpen,
    printState,
    printWorkorders,
    setPrintMenuOpen,
    setPrintState,
  } = useWorkorderPrintController({
    activeWorkorderId: activeWorkorder?.workorder?.id,
    activeWorkorderLocationId: activeWorkorder?.workorder?.locationId,
    effectiveCopies,
    form,
    previewSerials,
    range,
    request: api,
    setCreateState: setOfficeCreateState,
  });
  const closePrintMenu = useCallback(() => setPrintMenuOpen(false), [setPrintMenuOpen]);
  const isMechanicDetail = detailSource === "mechanic" && Boolean(activeWorkorder);
  const isOfficeDetail = detailSource === "office" && Boolean(activeWorkorder);
  const isWorkorderDetail = Boolean(activeWorkorder);
  const formController = useRoleRouterFormController({
    activeWorkorder,
    actorId: actor.id,
    form,
    isOfficeDetail,
    officeActionsRef,
    setActiveWorkorder,
    setCreateErrors: setOfficeCreateErrors,
    setForm,
    setUsedPartsDirty,
  });
  const {
    addPartRow,
    clearCreateErrors: clearOfficeCreateErrors,
    removePartRow,
    saveActiveUsedParts,
    stageOfficeAutosave: stageOfficeWorkorderAutosave,
    updateActiveUsedParts,
    updateActiveLaborHours,
    updateField,
    updatePart,
    updateStartDate,
  } = formController;
  const {
    fullscreenPageIndex,
    fullscreenZoom,
    isCompact,
    isPhone,
    jumpToPreview,
    openFullscreenPreview,
    previewFullscreen,
    previewPanelOpen,
    selectDetailSection,
    setFullscreenPageIndex,
    setFullscreenZoom,
    setPreviewFullscreen,
    setPreviewPanelOpen,
    setSupportingView,
    supportingView,
    toggleWorkorderTools,
  } = useWorkorderPreviewController({
    activeWorkorder,
    actorRole: actor.role,
    closePrintMenu,
    detailSection,
    detailStatus,
    effectiveCopies,
    isMechanicDetail,
    isWorkorderDetail,
    previewSerialCount: previewSerials.length,
    setDetailSection,
  });
  const {
    assignment: createAssignment,
    locations: officeLocations,
    locationsState: officeLocationsState,
    reloadLocations: loadCreateLocations,
    selectLocation: selectOfficeLocation,
    selectedLocation: selectedOfficeLocation,
    setAssignment: setCreateAssignment,
  } = useCreateLocationController({
    activeWorkorder,
    actorRole: actor.role,
    currentForm: form,
    request: api,
    workspace,
    onClearLocationError: clearOfficeCreateErrors,
    onFormPatch: (patch, { resetDraftBaseline } = {}) => {
      setForm((current) => {
        const next = { ...current, ...patch };
        if (resetDraftBaseline) createInitialDatesRef.current = createDraftBaselineFromForm(next);
        return next;
      });
    },
    onSelectionPatch: stageOfficeWorkorderAutosave,
  });
  const {
    applyVehicle,
    refreshVehicleLocation,
    resetVehicleLookup,
    restoreDraftVehicle,
    selectedVehicle,
    setSelectedVehicle,
    updateUnitNumber: updateVehicleUnitNumber,
    vehicleLookup,
  } = useVehicleLookupController({
    activeWorkorderId: activeWorkorder?.workorder?.id,
    clearCreateErrors: clearOfficeCreateErrors,
    companyId: activeWorkorderCompanyId(activeWorkorder, selectedOfficeLocation),
    enabled: workspace === "generator" || Boolean(activeWorkorder),
    form,
    setForm,
    stageAutosave: stageOfficeWorkorderAutosave,
  });
  const updateUnitNumber = useCallback(
    (value) => updateVehicleUnitNumber(value, updateField),
    [updateField, updateVehicleUnitNumber],
  );
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
  const activeWorkorderPolicy = activeWorkorderModulePolicy({ activeWorkorder, actorRole: actor.role, selectedOfficeLocation });
  const canOpenCreateWorkspace = useMemo(
    () => canOpenCreateWorkspaceForActor({ actor, locations: officeLocations }),
    [actor, officeLocations],
  );
  const {
    draft: workorderDraft,
    draftLeaveBusy,
    draftLeaveOpen,
    draftWorkspaceState,
    discardDraftFromWorkspace,
    loadDraftWorkspace,
    meaningful: workorderDraftMeaningful,
    openSavedDraft,
    payload: workorderDraftPayload,
    resumedDraft,
    restoreWorkorderDraft,
    setDraftLeaveBusy,
    setDraftLeaveOpen,
    setDraftWorkspaceState,
    setResumedDraft,
    takeOverDraft,
  } = useWorkorderDraftLifecycle({
    activeWorkorder,
    actor,
    canManageDrafts: capabilities.canManageDrafts,
    form,
    initialBaseline: createInitialDatesRef,
    mechanicUserIds: createMechanicUserIds,
    selectedLocation: selectedOfficeLocation, selectedVehicle,
    restoreDraftVehicle,
    setActiveWorkorder,
    setCreateAssignment,
    setCreateState: setOfficeCreateState,
    setDetailSource,
    setForm,
    setMode,
    setPreviewPanelOpen,
    setWorkspace,
    workspace,
  });
  const {
    finishRoleWorkspace: finishOpenOfficeWorkspace,
    openCreateWorkspace: openOfficeGenerator,
    openRoleWorkspace: openOfficeWorkspace,
  } = useRoleRouteNavigation({
    activeWorkorder,
    actor,
    createInitialDatesRef,
    createMode: capabilities.createMode,
    draftMeaningful: workorderDraftMeaningful,
    resetVehicleLookup,
    setActiveWorkorder,
    setCreateAssignment,
    setCreateErrors: setOfficeCreateErrors,
    setCreateState: setOfficeCreateState,
    setDetailSource,
    setDraftLeaveBusy,
    setDraftLeaveOpen,
    setForm,
    setMode,
    setPreviewPanelOpen,
    setResumedDraft,
    setWorkspace,
    workorderDraft,
    workspace,
  });
  const detailViewModel = useWorkorderDetailViewModel({
    activeWorkorder,
    detailStatus,
    form,
    interfaceLocale,
    isCompact,
    isMechanicDetail,
    isOfficeDetail,
    officeAssignment,
    policyOverrides: activeWorkorderPolicy,
    previewPanelOpen,
    role: actor.role,
    selectedOfficeLocation,
    selectedVehicle,
    userId: actor.id,
  });
  const saveDiagnosisRepair = useCallback(
    (payload) => updateDetailDiagnosisRepair({ ...payload, role: actor.role }), [actor.role]);
  const mechanicProgress = useMechanicProgress({
    actorId: actor.id,
    workorderId: activeWorkorder?.allowedActions?.saveNotes
      ? activeWorkorder?.workorder?.id : null,
    value: { diagnosis: form.diagnosis, workPerformed: form.workPerformed },
    initialVersion: activeWorkorder?.workorder?.progressVersion || 1,
    saveProgress: saveDiagnosisRepair,
  });
  const officeActions = useOfficeWorkorderActions({
    activeWorkorder,
    actorId: actor.id,
    clearEditBackup: clearOfficeWorkorderEditBackup,
    form,
    formValuesFromDetail: workorderFormValues,
    isOfficeDetail,
    officeAssignment,
    officeCancel,
    officeCloseNote,
    officeLocations,
    officeReturn,
    request: api,
    selectedVehicle,
    setActiveWorkorder,
    setDetailStatus,
    setForm,
    setOfficeAssignment,
    setOfficeCancel,
    setOfficeCloseNote,
    setOfficeCloseOpen,
    setOfficeDetailState,
    setOfficeReturn,
    setUsedPartsDirty,
    writeEditBackup: writeOfficeWorkorderEditBackup,
  });
  officeActionsRef.current = officeActions;
  const {
    cancelOfficeWorkorder,
    closeOfficeWorkorder,
    markOfficeWorkorderDone,
    openOfficeCancel,
    openOfficeReturn,
    returnOfficeWorkorder,
    saveOfficeWorkorder,
    updateOfficeMechanicTeam,
  } = officeActions;
  const {
    hydrateOfficeWorkorder,
    hydrateOperationalWorkorder,
    openOfficeWorkorder,
    openOperationalWorkorder,
  } = useWorkorderDetailRoute({
    actor,
    isCompact,
    officeLocations,
    queueOfficeAutosave: officeActions.queueOfficeWorkorderAutosave,
    setActiveWorkorder,
    setDetailSection,
    setDetailSource,
    setDetailStatus,
    setForm,
    setMechanicAction,
    setMode,
    setOfficeAssignment,
    setOfficeDetailState,
    setPreviewPanelOpen,
    setSelectedVehicle,
    setSupportingView,
    setWorkspace,
  });
  const {
    acceptOpenedMechanicWorkorder,
    reloadActiveWorkorder,
    returnToMyWork,
    sendWorkorderChat,
    shouldPreserveActiveWorkorderForm,
    submitMechanicFinish,
  } = useMechanicWorkorderActions({
    activeWorkorder,
    apiRequest: api,
    detailLoader: loadWorkorderDetail,
    form,
    isMechanicDetail,
    isOfficeDetail,
    mechanicProgress,
    normalizeWorkorderForm: workorderFormValues,
    officeLocations,
    replaceRoute: replaceRouteSearch,
    setActiveWorkorder,
    selectDetailSection,
    setDetailSource,
    setDetailStatus,
    setForm,
    setMechanicAction,
    setMechanicFinish,
    setOfficeCancel,
    setOfficeReturn,
    setPreviewPanelOpen,
    setSelectedVehicle,
    setWorkspace,
  });
  const {
    createWorkorder: createOfficeWorkorder,
    discardDraftAndLeave,
    returnToRoleWorkspace,
    saveDraftAndLeave,
  } = useRoleRouterCommands({
    activeWorkorder,
    actor,
    createAssignment,
    finishRoleWorkspace: finishOpenOfficeWorkspace,
    form,
    openOfficeWorkorder,
    openOperationalWorkorder,
    openRoleWorkspace: openOfficeWorkspace,
    returnToMyWork,
    setCreateAttempt: setOfficeCreateAttempt,
    setCreateErrors: setOfficeCreateErrors,
    setCreateState: setOfficeCreateState,
    setDraftLeaveBusy,
    setResumedDraft,
    workorderDraft,
    workorderDraftPayload,
  });
  useInitialRoleRouteHydration({
    actor,
    canManageDrafts: capabilities.canManageDrafts,
    finishRoleWorkspace: finishOpenOfficeWorkspace,
    hydrateOfficeWorkorder,
    hydrateOperationalWorkorder,
    restoreWorkorderDraft,
    setDraftWorkspaceState,
    setRouteLoading,
    setWorkspace,
  });
  useRoleRouterLifecycleEffects({
    activeWorkorder, actor, detailSource, form, isMechanicDetail, mechanicProgress,
    mechanicProgressBackupRestoredRef, reloadActiveWorkorder, setForm, setMapsConfig,
    setMechanicAction, setUsedPartsDirty, shouldPreserveActiveWorkorderForm, usedPartsDirty,
  });
  return (
    <RoleWorkspaceOutlet
      activeWorkorder={activeWorkorder}
      actor={actor}
      routeLoading={routeLoading}
      workspace={workspace}
      interfacePreferences={{
        error: interfacePreferences.error,
        locale: interfaceLocale,
        onLocaleChange: interfacePreferences.saveLocale,
      }}
      navigation={{
        canOpenCreateWorkspace,
        openCreateWorkspace: canOpenCreateWorkspace ? openOfficeGenerator : null,
        openOfficeWorkorder,
        openOperationalWorkorder,
      }}
      draftWorkspaceProps={{
        drafts: draftWorkspaceState.drafts, draftLoading: draftWorkspaceState.loading,
        draftError: draftWorkspaceState.error, draftBusyId: draftWorkspaceState.busyId,
        onOpenDraft: openSavedDraft, onDiscardDraft: discardDraftFromWorkspace,
        onTakeoverDraft: takeOverDraft, onRefreshDrafts: loadDraftWorkspace,
      }}
      detailPageProps={{
        ...detailViewModel,
        activeWorkorder, actor, browserPrintPayload, canPrint, detailSection, detailStatus,
        effectiveCopies, firstSerial, form, formRef, fullscreenPageIndex, fullscreenZoom,
        isCompact, isMechanicDetail, isOfficeDetail, isPhone, locale: interfaceLocale,
        localeError: interfacePreferences.error, lastPhysicalPageIndex, lastSerial, mapsConfig,
        mechanicAction, mechanicFinish, mechanicProgress, officeAssignment, officeCancel,
        officeCloseNote, officeCloseOpen, officeDetailState, officeLocations, officeReturn,
        previewFullscreen, previewGridRef, previewPanelOpen, previewRef, previewSerials,
        printMenuOpen, printState, primaryActionLabel, range, selectedVehicle,
        supportingView, vehicleLookup, workorderCountLabel, applyVehicle,
        acceptOpenedMechanicWorkorder, cancelOfficeWorkorder, closeOfficeWorkorder, markOfficeWorkorderDone,
        jumpToPreview, openFullscreenPreview, openOfficeCancel, openOfficeReturn,
        onLocaleChange: interfacePreferences.saveLocale, printWorkorders, reloadActiveWorkorder,
        returnOfficeWorkorder, returnToRoleWorkspace, saveActiveUsedParts, saveOfficeWorkorder,
        selectDetailSection, selectOfficeLocation, sendWorkorderChat, setDetailSection,
        setFullscreenPageIndex, setFullscreenZoom, setMechanicFinish, setOfficeAssignment,
        setOfficeCancel, setOfficeCloseNote, setOfficeCloseOpen, setOfficeDetailState,
        setOfficeReturn, setPreviewFullscreen, setPrintMenuOpen, setPrintState,
        setSupportingView, submitMechanicFinish, toggleWorkorderTools, updateActiveUsedParts, updateActiveLaborHours,
        updateField, updateOfficeMechanicTeam, updateStartDate, updateUnitNumber,
        vehicleMileage, vehicleModelText,
      }}
      createPageProps={{
        actor, assignment: createAssignmentForRole, browserPrintPayload, effectiveCopies,
        firstSerial, form, formRef, fullscreenPageIndex, fullscreenZoom, isPhone,
        lastPhysicalPageIndex, lastSerial, locationPolicy: selectedOfficeLocation?.policy || null,
        mapsConfig, officeCreateAttempt,
        officeCreateErrors, officeCreateState, officeLocations, officeLocationsState,
        previewFullscreen, previewGridRef, previewRef, previewSerials, printMenuOpen,
        printState, primaryActionLabel, range, selectedVehicle,
        showEmbeddedPreview: detailViewModel.showEmbeddedPreview, vehicleLookup,
        workorderCountLabel, workorderDraft, draftLeaveBusy, draftLeaveOpen,
        addPartRow, applyVehicle, createOfficeWorkorder, discardDraftAndLeave,
        jumpToPreview, openFullscreenPreview, openOfficeWorkspace, reloadOfficeLocations: loadCreateLocations,
        removePartRow, saveDraftAndLeave, selectOfficeLocation, setCreateAssignment,
        setDraftLeaveOpen, setFullscreenPageIndex, setFullscreenZoom, setPreviewFullscreen,
        setPrintMenuOpen, setPrintState, updateField, updatePart, updateUnitNumber,
      }}
    />
  );
}

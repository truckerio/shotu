import { useCallback, useEffect, useRef, useState } from "react";
import { resolveWorkPerformed } from "../../../../shared/workorder-completion.js";

const ADMINISTRATIVE_FORM_EXCLUSIONS = new Set([
  "diagnosis",
  "workPerformed",
  "laborHours",
  "mechanicName",
  "startTime",
  "endTime",
  "managerName",
]);

const CUSTOMER_DOCUMENT_FORM_FIELDS = new Set([
  "customerDocumentAdjustments",
  "customerDocumentAdjustmentBaseRevisionId",
]);

function requireDependency(value, name) {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
  return value;
}

function workorderPath(workorderId, suffix = "") {
  const normalizedId = String(workorderId || "").trim();
  if (!normalizedId) throw new TypeError("Workorder ID is required.");
  return `/api/office/workorders/${normalizedId}${suffix}`;
}

export function officeActionValidationMessage(action, value) {
  const normalized = String(value || "").trim();
  if (action === "return" && normalized.length < 2) return "Add a reason for the mechanic.";
  if (action === "cancel" && normalized.length < 2) return "Add a cancellation reason.";
  if (action === "assignment" && !normalized) return "Add a reason before changing the mechanic team.";
  return "";
}

export function createOfficeAutosaveQueue() {
  let inFlight = false;
  let queued = false;
  let scheduledRevision = 0;
  return {
    schedule(revision) {
      if (!revision || revision <= scheduledRevision) return false;
      scheduledRevision = revision;
      return true;
    },
    begin() {
      if (inFlight) {
        queued = true;
        return false;
      }
      inFlight = true;
      return true;
    },
    finish({ currentRevision, savingRevision }) {
      inFlight = false;
      const shouldRunAgain = queued || currentRevision > savingRevision;
      queued = false;
      return shouldRunAgain;
    },
  };
}

export function createOfficeWorkorderIdentityTracker(initialWorkorderId = "") {
  let current = { id: String(initialWorkorderId || ""), generation: 0 };
  return {
    update(workorderId) {
      const id = String(workorderId || "");
      if (id !== current.id) current = { id, generation: current.generation + 1 };
      return current;
    },
    isCurrent(identity) {
      return current === identity;
    },
  };
}

function normalizedLaborProduct(formLaborProduct, savedLaborProduct) {
  if (formLaborProduct == null) return null;
  if (String(formLaborProduct?.productId || "").trim()) return formLaborProduct;
  if (String(savedLaborProduct?.productId || "").trim()) return savedLaborProduct;
  return null;
}

function sameFormValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameFormValue(value, right[index]));
  }
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key, index) => key === rightKeys[index] && sameFormValue(left[key], right[key]));
  }
  return false;
}

function changedCustomerDocumentFields(form, savedForm) {
  return Object.fromEntries([...CUSTOMER_DOCUMENT_FORM_FIELDS]
    .filter((key) => Object.hasOwn(form, key) && !sameFormValue(form[key], savedForm[key]))
    .map((key) => [key, form[key]]));
}

function changedLaborHours(form, savedForm) {
  if (!Object.hasOwn(form, "laborHours")) return {};
  const requested = String(form.laborHours ?? "").trim();
  const saved = String(savedForm.laborHours ?? "").trim();
  return requested === saved ? {} : { laborHours: form.laborHours ?? "" };
}

export function buildOfficeWorkorderPatch({ activeWorkorder, form, selectedVehicle }) {
  const workorder = activeWorkorder?.workorder;
  if (!workorder) throw new TypeError("An active workorder is required.");
  const savedUnitNo = String(workorder.formData?.unitNo || workorder.asset?.unitNo || "").trim().toLowerCase();
  const currentUnitNo = String(form.unitNo || "").trim().toLowerCase();

  const savedAdministrativeForm = Object.fromEntries(
    Object.entries(workorder.formData || {}).filter(([key]) => (
      !ADMINISTRATIVE_FORM_EXCLUSIONS.has(key) && !CUSTOMER_DOCUMENT_FORM_FIELDS.has(key)
    )),
  );
  const changedCustomerDocumentForm = changedCustomerDocumentFields(form, workorder.formData || {});
  const changedLaborForm = changedLaborHours(form, workorder.formData || {});

  return {
    assetId: selectedVehicle?.id || (currentUnitNo === savedUnitNo ? workorder.asset?.id : null) || null,
    locationId: form.locationId || workorder.locationId || null,
    concern: form.mechanicConcern,
    officeNotes: form.officeNotes || "",
    formData: {
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
      // Labor selection is office-owned form data. Keep an explicit null so a
      // cleared selector does not silently retain the previously saved product.
      laborProduct: normalizedLaborProduct(form.laborProduct, workorder.formData?.laborProduct),
      parts: form.parts,
      ...changedLaborForm,
      ...changedCustomerDocumentForm,
    },
    expectedUpdatedAt: workorder.updatedAt,
  };
}

export async function patchOfficeWorkorder({ request, workorderId, payload }) {
  return requireDependency(request, "request")(workorderPath(workorderId), {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function loadOfficeWorkorder({ request, workorderId }) {
  return requireDependency(request, "request")(workorderPath(workorderId));
}

export async function runOfficeWorkorderAction({ request, workorderId, action, body }) {
  return requireDependency(request, "request")(workorderPath(workorderId, `/${action}`), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function saveOfficeUsedPartsRequest({ request, workorderId, parts }) {
  return requireDependency(request, "request")(workorderPath(workorderId, "/used-parts"), {
    method: "PATCH",
    body: JSON.stringify({ parts }),
  });
}

export async function persistOfficeWorkorderSave({
  applyDetail,
  automatic,
  isCurrent,
  payload,
  request,
  workorderId,
}) {
  await patchOfficeWorkorder({ request, workorderId, payload });
  if (!isCurrent()) return { saved: true, stale: true, detail: null };

  const detail = await loadOfficeWorkorder({ request, workorderId });
  if (!isCurrent()) return { saved: true, stale: true, detail: null };

  applyDetail(detail, { refreshForm: !automatic });
  return { saved: true, stale: false, detail };
}

export function useOfficeWorkorderActions({
  activeWorkorder,
  actorId,
  clearEditBackup,
  form,
  formValuesFromDetail,
  isOfficeDetail,
  officeAssignment,
  officeCancel,
  officeCloseNote,
  officeLocations,
  officeReturn,
  request,
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
  writeEditBackup,
  autosaveDelay = 700,
}) {
  const autosaveTimerRef = useRef(null);
  const autosaveQueueRef = useRef(null);
  if (!autosaveQueueRef.current) autosaveQueueRef.current = createOfficeAutosaveQueue();
  const autosaveRevisionRef = useRef(0);
  const [autosaveRevision, setAutosaveRevision] = useState(0);
  const workorderIdentityTrackerRef = useRef(null);
  if (!workorderIdentityTrackerRef.current) {
    workorderIdentityTrackerRef.current = createOfficeWorkorderIdentityTracker(
      activeWorkorder?.workorder?.id,
    );
  }
  const workorderIdentity = workorderIdentityTrackerRef.current.update(activeWorkorder?.workorder?.id);

  const applyDetail = useCallback((detail, { refreshForm = true } = {}) => {
    setActiveWorkorder(detail);
    setDetailStatus(detail.workorder.status);
    if (refreshForm) {
      setForm((current) => formValuesFromDetail({ detail, current, officeLocations }));
    }
    return detail;
  }, [formValuesFromDetail, officeLocations, setActiveWorkorder, setDetailStatus, setForm]);

  const reloadOfficeWorkorder = useCallback(async (workorderId, options) => {
    const detail = await loadOfficeWorkorder({ request, workorderId });
    return applyDetail(detail, options);
  }, [applyDetail, request]);

  const stageOfficeWorkorderAutosave = useCallback((patch) => {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!isOfficeDetail || !activeWorkorder?.allowedActions?.update || !workorderId) return false;
    requireDependency(writeEditBackup, "writeEditBackup")(actorId, workorderId, patch);
    autosaveRevisionRef.current += 1;
    setAutosaveRevision((current) => current + 1);
    return true;
  }, [activeWorkorder, actorId, isOfficeDetail, writeEditBackup]);

  const queueOfficeWorkorderAutosave = useCallback(() => {
    autosaveRevisionRef.current += 1;
    setAutosaveRevision((current) => current + 1);
  }, []);

  const saveOfficeWorkorder = useCallback(async (options = {}) => {
    const workorder = activeWorkorder?.workorder;
    if (!workorder || !isOfficeDetail) return false;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = null;
    if (!autosaveQueueRef.current.begin()) return false;

    const automatic = options?.automatic === true;
    const savingRevision = autosaveRevisionRef.current;
    const savingQueue = autosaveQueueRef.current;
    const savingIdentity = workorderIdentity;
    const isCurrent = () => workorderIdentityTrackerRef.current.isCurrent(savingIdentity);
    setOfficeDetailState({ busy: true, message: "Saving..." });
    try {
      const result = await persistOfficeWorkorderSave({
        applyDetail,
        automatic,
        isCurrent,
        payload: buildOfficeWorkorderPatch({ activeWorkorder, form, selectedVehicle }),
        request,
        workorderId: workorder.id,
      });
      if (result.stale) return true;
      const { detail } = result;
      if (autosaveRevisionRef.current === savingRevision) {
        requireDependency(clearEditBackup, "clearEditBackup")(actorId, detail.workorder.id);
      }
      setOfficeDetailState({
        busy: false,
        message: automatic ? "Saved automatically." : "Saved. Mechanic view will update from this record.",
      });
      return true;
    } catch (error) {
      if (isCurrent()) setOfficeDetailState({ busy: false, message: error.message, error: true });
      return false;
    } finally {
      if (savingQueue.finish({
        currentRevision: autosaveRevisionRef.current,
        savingRevision,
      })) {
        setAutosaveRevision((current) => current + 1);
      }
    }
  }, [
    activeWorkorder,
    actorId,
    clearEditBackup,
    form,
    isOfficeDetail,
    applyDetail,
    request,
    selectedVehicle,
    setOfficeDetailState,
    workorderIdentity,
  ]);

  useEffect(() => {
    if (!autosaveRevision || !isOfficeDetail || !activeWorkorder?.allowedActions?.update) return undefined;
    if (!autosaveQueueRef.current.schedule(autosaveRevision)) return undefined;
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      saveOfficeWorkorder({ automatic: true });
    }, autosaveDelay);
    return () => clearTimeout(autosaveTimerRef.current);
  }, [activeWorkorder?.allowedActions?.update, autosaveDelay, autosaveRevision, isOfficeDetail, saveOfficeWorkorder]);

  useEffect(() => () => clearTimeout(autosaveTimerRef.current), []);

  const closeOfficeWorkorder = useCallback(async (event) => {
    event?.preventDefault?.();
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isOfficeDetail) return false;
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await runOfficeWorkorderAction({
        request,
        workorderId,
        action: "close",
        body: { note: officeCloseNote },
      });
      await reloadOfficeWorkorder(workorderId);
      setOfficeCloseOpen(false);
      setOfficeCloseNote("");
      setOfficeDetailState({ busy: false, message: "Workorder approved and sent to surveillance." });
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message, error: true });
      return false;
    }
  }, [
    activeWorkorder?.workorder?.id,
    isOfficeDetail,
    officeCloseNote,
    reloadOfficeWorkorder,
    request,
    setOfficeCloseNote,
    setOfficeCloseOpen,
    setOfficeDetailState,
  ]);

  const markOfficeWorkorderDone = useCallback(async () => {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isOfficeDetail) return false;
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await runOfficeWorkorderAction({
        request,
        workorderId,
        action: "mark-done",
        body: {
          diagnosis: form.diagnosis || "",
          workPerformed: resolveWorkPerformed(form),
        },
      });
      await reloadOfficeWorkorder(workorderId);
      setOfficeDetailState({
        busy: false,
        message: "Work marked done. Review and approve it when ready.",
      });
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message, error: true });
      return false;
    }
  }, [
    activeWorkorder?.workorder?.id,
    form,
    isOfficeDetail,
    reloadOfficeWorkorder,
    request,
    setOfficeDetailState,
  ]);

  const openOfficeReturn = useCallback(() => {
    setOfficeDetailState((current) => ({ ...current, message: "" }));
    setOfficeReturn({ open: true, reason: "", categories: [], message: "" });
  }, [setOfficeDetailState, setOfficeReturn]);

  const openOfficeCancel = useCallback(() => {
    setOfficeDetailState((current) => ({ ...current, message: "" }));
    setOfficeCancel({ open: true, reason: "", message: "" });
  }, [setOfficeCancel, setOfficeDetailState]);

  const returnOfficeWorkorder = useCallback(async (event) => {
    event?.preventDefault?.();
    const reason = officeReturn.reason.trim();
    const validationMessage = officeActionValidationMessage("return", reason);
    if (validationMessage) {
      setOfficeReturn((current) => ({ ...current, message: validationMessage }));
      return false;
    }
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isOfficeDetail) return false;
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await runOfficeWorkorderAction({
        request,
        workorderId,
        action: "return",
        body: { reason, categories: officeReturn.categories },
      });
      await reloadOfficeWorkorder(workorderId);
      setOfficeReturn({ open: false, reason: "", categories: [], message: "" });
      setOfficeDetailState({ busy: false, message: "Returned to the mechanic with your requested changes." });
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: "" });
      setOfficeReturn((current) => ({ ...current, message: error.message }));
      return false;
    }
  }, [
    activeWorkorder?.workorder?.id,
    isOfficeDetail,
    officeReturn,
    reloadOfficeWorkorder,
    request,
    setOfficeDetailState,
    setOfficeReturn,
  ]);

  const cancelOfficeWorkorder = useCallback(async (event) => {
    event?.preventDefault?.();
    const reason = officeCancel.reason.trim();
    const validationMessage = officeActionValidationMessage("cancel", reason);
    if (validationMessage) {
      setOfficeCancel((current) => ({ ...current, message: validationMessage }));
      return false;
    }
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isOfficeDetail) return false;
    setOfficeDetailState({ busy: true, message: "" });
    try {
      await runOfficeWorkorderAction({
        request,
        workorderId,
        action: "cancel",
        body: { reason },
      });
      await reloadOfficeWorkorder(workorderId);
      setOfficeCancel({ open: false, reason: "", message: "" });
      setOfficeDetailState({ busy: false, message: "Workorder cancelled. The reason remains in Activity." });
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: "" });
      setOfficeCancel((current) => ({ ...current, message: error.message }));
      return false;
    }
  }, [
    activeWorkorder?.workorder?.id,
    isOfficeDetail,
    officeCancel,
    reloadOfficeWorkorder,
    request,
    setOfficeCancel,
    setOfficeDetailState,
  ]);

  const updateOfficeMechanicTeam = useCallback(async () => {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isOfficeDetail) return false;
    const reason = officeAssignment.reason.trim();
    const validationMessage = officeActionValidationMessage("assignment", reason);
    if (validationMessage) {
      setOfficeDetailState({ busy: false, message: validationMessage, error: true });
      return false;
    }
    setOfficeDetailState({ busy: true, message: "Updating assignment..." });
    try {
      await runOfficeWorkorderAction({
        request,
        workorderId,
        action: "assignments",
        body: { mechanicUserIds: officeAssignment.mechanicUserIds, reason },
      });
      const detail = await reloadOfficeWorkorder(workorderId);
      const team = detail.workorder.mechanics || [];
      setOfficeAssignment({ mechanicUserIds: team.map((mechanic) => mechanic.id), reason: "" });
      setOfficeDetailState({
        busy: false,
        message: team.length
          ? `Assigned to ${team.map((mechanic) => mechanic.name).join(", ")}.`
          : "Workorder returned to the available queue.",
      });
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message, error: true });
      return false;
    }
  }, [
    activeWorkorder?.workorder?.id,
    isOfficeDetail,
    officeAssignment,
    reloadOfficeWorkorder,
    request,
    setOfficeAssignment,
    setOfficeDetailState,
  ]);

  const saveActiveUsedParts = useCallback(async (parts) => {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) throw new Error("Open a workorder before saving parts.");
    const result = await saveOfficeUsedPartsRequest({ request, workorderId, parts });
    return {
      parts: result.workorder.formData?.parts || [],
      workorder: result.workorder,
    };
  }, [activeWorkorder?.workorder?.id, request]);

  return {
    autosaveRevision,
    cancelOfficeWorkorder,
    closeOfficeWorkorder,
    markOfficeWorkorderDone,
    openOfficeCancel,
    openOfficeReturn,
    queueOfficeWorkorderAutosave,
    returnOfficeWorkorder,
    saveActiveUsedParts,
    saveOfficeWorkorder,
    stageOfficeWorkorderAutosave,
    updateOfficeMechanicTeam,
  };
}

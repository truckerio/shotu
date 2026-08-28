import { useMemo } from "react";
import { resolveWorkPerformed } from "../../../../shared/workorder-completion.js";
import { interfaceText } from "../../i18n/index.js";

const DETAIL_FORM_CONTROL_SELECTOR = [
  ".workorder-detail-page input",
  ".workorder-detail-page textarea",
  ".workorder-detail-page select",
  ".workorder-detail-page [contenteditable='true']",
].join(", ");

export function mechanicActionResult({
  currentDetail,
  result,
  nextStatus,
}) {
  const nextWorkorder = result?.workorder;
  const nextMessage = result?.message;

  if (nextWorkorder) {
    return {
      detail: { ...currentDetail, workorder: nextWorkorder },
      status: nextWorkorder.status,
    };
  }

  if (nextMessage) {
    const message = {
      ...nextMessage,
      senderName: nextMessage.senderName || currentDetail?.user?.name || "You",
    };
    return {
      detail: {
        ...currentDetail,
        messages: [...(currentDetail?.messages || []), message],
        workorder: nextStatus
          ? { ...currentDetail?.workorder, status: nextStatus }
          : currentDetail?.workorder,
      },
      status: nextStatus || currentDetail?.workorder?.status,
    };
  }

  return {
    detail: currentDetail,
    status: nextStatus || currentDetail?.workorder?.status,
  };
}

export function mechanicChatRequest({
  body,
  attachment,
  clientMessageId,
  isOfficeDetail,
  workorderId,
}) {
  return {
    path: `/api/${isOfficeDetail ? "office" : "mechanic"}/workorders/${workorderId}/messages`,
    options: {
      method: "POST",
      body: JSON.stringify({
        body,
        clientMessageId,
        ...(attachment ? { attachment } : {}),
      }),
    },
  };
}

export function mechanicFinishError(form, localeText = (key) => interfaceText("en", key)) {
  return resolveWorkPerformed(form)
    ? ""
    : localeText("mechanic.repairRequiredBeforeDone");
}

export function shouldPreserveMechanicWorkorderForm({
  activeElement,
  isMechanicDetail,
  mechanicProgress,
}) {
  if (
    isMechanicDetail
    && (mechanicProgress?.hasUnsyncedChanges || mechanicProgress?.status === "saving")
  ) return true;

  return Boolean(activeElement?.closest?.(DETAIL_FORM_CONTROL_SELECTOR));
}

function browserActiveElement() {
  return globalThis.document?.activeElement || null;
}

function browserRequestAnimationFrame(callback) {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }
  callback();
  return 0;
}

function focusMechanicWorkPerformed() {
  const field = globalThis.document?.getElementById("mechanic-work-performed");
  field?.scrollIntoView?.({ behavior: "smooth", block: "center" });
  field?.focus?.({ preventScroll: true });
}

export function createMechanicWorkorderActions({
  activeWorkorder,
  apiRequest,
  detailLoader,
  focusWorkPerformed = focusMechanicWorkPerformed,
  form,
  getActiveElement = browserActiveElement,
  isMechanicDetail,
  isOfficeDetail,
  localeText = (key) => interfaceText("en", key),
  localizedError = (error) => error?.message || interfaceText("en", "mechanic.requestFailed"),
  mechanicProgress,
  normalizeWorkorderForm,
  officeLocations,
  replaceRoute,
  requestFrame = browserRequestAnimationFrame,
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
}) {
  async function returnToMyWork() {
    if (isMechanicDetail && mechanicProgress.hasUnsyncedChanges) {
      setMechanicAction({ busy: "progress", message: localeText("mechanic.savingBeforeLeaving") });
      try {
        await mechanicProgress.flush({ recordActivity: true });
      } catch (error) {
        setMechanicAction({
          busy: "",
          message: `${localizedError(error)} ${localeText("mechanic.recoveryPreserved")}`,
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
    replaceRoute("");
    return true;
  }

  async function runMechanicAction(name, request, successMessage, nextStatus) {
    if (!activeWorkorder) return undefined;
    setMechanicAction({ busy: name, message: "" });
    try {
      const result = await request(activeWorkorder);
      const resolved = mechanicActionResult({
        currentDetail: activeWorkorder,
        result,
        nextStatus,
      });

      if (result?.workorder || result?.message) {
        setActiveWorkorder((current) => mechanicActionResult({
          currentDetail: current,
          result,
          nextStatus,
        }).detail);
      }
      if (resolved.status && (result?.workorder || nextStatus)) {
        setDetailStatus(resolved.status);
      }
      setMechanicAction({ busy: "", message: successMessage });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: localizedError(error) });
      return false;
    }
  }

  async function reloadActiveWorkorder(options = {}) {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId) return undefined;

    const detail = await detailLoader({
      role: isOfficeDetail ? "office" : "mechanic",
      workorderId,
    });
    setActiveWorkorder(detail);
    setDetailStatus(detail.workorder.status);
    if (!options.preserveForm) {
      setForm((current) => normalizeWorkorderForm({
        detail,
        current,
        officeLocations,
      }));
    }
    return detail;
  }

  async function sendWorkorderChat({ body, attachment, clientMessageId }) {
    const workorderId = activeWorkorder?.workorder?.id;
    if ((!body && !attachment) || !workorderId) return false;

    setMechanicAction({ busy: "chat", message: "" });
    try {
      const request = mechanicChatRequest({
        body,
        attachment,
        clientMessageId,
        isOfficeDetail,
        workorderId,
      });
      await apiRequest(request.path, request.options);
      await reloadActiveWorkorder({ preserveForm: shouldPreserveActiveWorkorderForm() });
      setMechanicAction({ busy: "", message: "" });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: localizedError(error) });
      return false;
    }
  }

  function shouldPreserveActiveWorkorderForm() {
    return shouldPreserveMechanicWorkorderForm({
      activeElement: getActiveElement(),
      isMechanicDetail,
      mechanicProgress,
    });
  }

  async function acceptOpenedMechanicWorkorder() {
    const workorderId = activeWorkorder?.workorder?.id;
    if (!workorderId || !isMechanicDetail) return false;

    setMechanicAction({ busy: "accept", message: "" });
    try {
      await apiRequest(`/api/mechanic/workorders/${encodeURIComponent(workorderId)}/accept`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const detail = await detailLoader({ role: "mechanic", workorderId });
      setActiveWorkorder(detail);
      setDetailStatus(detail.workorder.status);
      setForm((current) => normalizeWorkorderForm({ detail, current, officeLocations }));
      mechanicProgress.reset({
        id: detail.workorder.id,
        progress: detail.workorder,
        nextVersion: detail.workorder.progressVersion,
      });
      setMechanicAction({
        busy: "",
        message: localeText("mechanic.workAccepted"),
      });
      return true;
    } catch (error) {
      setMechanicAction({ busy: "", message: localizedError(error) });
      return false;
    }
  }

  async function markMechanicWorkDone() {
    try {
      await mechanicProgress.flush({ recordActivity: true });
    } catch (error) {
      setMechanicAction({ busy: "", message: localizedError(error) });
      return false;
    }

    return runMechanicAction(
      "done",
      (detail) => apiRequest(`/api/mechanic/workorders/${detail.workorder.id}/mark-done`, {
        method: "POST",
        body: JSON.stringify({
          diagnosis: form.diagnosis,
          workPerformed: resolveWorkPerformed(form),
        }),
      }),
      localeText("mechanic.sentForReview"),
    );
  }

  async function submitMechanicFinish(event) {
    event.preventDefault();
    const validationError = mechanicFinishError(form, localeText);
    if (validationError) {
      setMechanicFinish({ open: false, name: "", message: "" });
      selectDetailSection("diagnosisRepair");
      setMechanicAction({
        busy: "",
        message: validationError,
        validationField: "workPerformed",
      });
      requestFrame(() => requestFrame(focusWorkPerformed));
      return false;
    }

    const finished = await markMechanicWorkDone();
    if (finished) setMechanicFinish({ open: false, name: "", message: "" });
    return finished;
  }

  return {
    acceptOpenedMechanicWorkorder,
    markMechanicWorkDone,
    reloadActiveWorkorder,
    returnToMyWork,
    runMechanicAction,
    sendWorkorderChat,
    shouldPreserveActiveWorkorderForm,
    submitMechanicFinish,
  };
}

export function useMechanicWorkorderActions(dependencies) {
  return useMemo(
    () => createMechanicWorkorderActions(dependencies),
    [dependencies],
  );
}

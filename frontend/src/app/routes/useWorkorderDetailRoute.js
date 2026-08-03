import { useCallback, useEffect } from "react";

import {
  currentRouteParams,
  draftsSearch,
  replaceRouteSearch,
  workorderDetailSearch,
} from "./route-state.js";
import { workorderDraftOwnerId, workorderFormValues } from "./role-router-model.js";
import {
  defaultDetailSection,
  defaultSupportingView,
} from "../../features/workorder-detail/workorder-detail-sections.js";
import { loadWorkorderDetail } from "../../features/workorder-detail/workorder-detail-loader.js";
import { readOfficeWorkorderEditBackup } from "../../features/workorder-detail/office-workorder-autosave-storage.js";
import { api } from "../../lib/api.js";

const ROUTABLE_DETAIL_SECTIONS = ["work", "chat", "parts", "preview", "unit", "team", "activity"];

export function requestedDetailSection({ requestedSection, role, status, isCompact }) {
  return ROUTABLE_DETAIL_SECTIONS.includes(requestedSection)
    ? requestedSection
    : defaultDetailSection(role, status, isCompact);
}

export function useWorkorderDetailRoute({
  actor,
  isCompact,
  officeLocations,
  queueOfficeAutosave,
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
}) {
  const hydrateOperationalWorkorder = useCallback((detail, { updateRoute = true } = {}) => {
    const workorder = detail.workorder;
    const nextSection = requestedDetailSection({
      requestedSection: currentRouteParams().get("section"),
      role: "mechanic",
      status: workorder.status,
      isCompact,
    });
    setActiveWorkorder(detail);
    setPreviewPanelOpen(true);
    setDetailSource("mechanic");
    setMode("mechanic");
    setDetailStatus(workorder.status);
    setSelectedVehicle(workorder.asset || null);
    setMechanicAction({ busy: "", message: "" });
    setDetailSection(nextSection);
    setSupportingView(nextSection === "chat" ? "chat" : defaultSupportingView("mechanic", workorder.status));
    setForm((current) => workorderFormValues({ detail, current, officeLocations }));
    setWorkspace("generator");
    if (updateRoute) replaceRouteSearch(workorderDetailSearch(workorder.id, nextSection));
  }, [
    isCompact,
    officeLocations,
    setActiveWorkorder,
    setDetailSection,
    setDetailSource,
    setDetailStatus,
    setForm,
    setMechanicAction,
    setMode,
    setPreviewPanelOpen,
    setSelectedVehicle,
    setSupportingView,
    setWorkspace,
  ]);

  const hydrateOfficeWorkorder = useCallback((detail, { updateRoute = true } = {}) => {
    const workorder = detail.workorder;
    const editBackup = readOfficeWorkorderEditBackup(actor.id, workorder.id);
    const nextSection = requestedDetailSection({
      requestedSection: currentRouteParams().get("section"),
      role: actor.role,
      status: workorder.status,
      isCompact,
    });
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
    setDetailSection(nextSection);
    setSupportingView(nextSection === "chat" ? "chat" : defaultSupportingView(actor.role, workorder.status));
    setForm((current) => ({ ...workorderFormValues({ detail, current, officeLocations }), ...(editBackup || {}) }));
    setWorkspace("generator");
    if (editBackup) queueOfficeAutosave();
    setOfficeDetailState({
      busy: false,
      message: editBackup ? "Recovered unsaved changes. Saving automatically..." : "",
    });
    if (updateRoute) replaceRouteSearch(workorderDetailSearch(workorder.id, nextSection));
  }, [
    actor.id,
    actor.role,
    isCompact,
    officeLocations,
    queueOfficeAutosave,
    setActiveWorkorder,
    setDetailSection,
    setDetailSource,
    setDetailStatus,
    setForm,
    setMode,
    setOfficeAssignment,
    setOfficeDetailState,
    setPreviewPanelOpen,
    setSelectedVehicle,
    setSupportingView,
    setWorkspace,
  ]);

  const openOfficeWorkorder = useCallback(async (workorderId) => {
    setOfficeDetailState({ busy: true, message: "" });
    try {
      const detail = await loadWorkorderDetail({ markOpened: true, role: actor.role, workorderId });
      hydrateOfficeWorkorder(detail);
      return true;
    } catch (error) {
      setOfficeDetailState({ busy: false, message: error.message });
      return false;
    }
  }, [actor.role, hydrateOfficeWorkorder, setOfficeDetailState]);

  return {
    hydrateOfficeWorkorder,
    hydrateOperationalWorkorder,
    openOfficeWorkorder,
    openOperationalWorkorder: hydrateOperationalWorkorder,
  };
}

export function useInitialRoleRouteHydration({
  actor,
  canManageDrafts,
  finishRoleWorkspace,
  hydrateOfficeWorkorder,
  hydrateOperationalWorkorder,
  restoreWorkorderDraft,
  setDraftWorkspaceState,
  setRouteLoading,
  setWorkspace,
}) {
  useEffect(() => {
    const params = currentRouteParams();
    const workorderId = params.get("workorder");
    const draftId = params.get("draft");
    if (draftId && canManageDrafts) {
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
        .catch(() => finishRoleWorkspace())
        .finally(() => setRouteLoading(false));
      return;
    }
    if (!workorderId) return;
    loadWorkorderDetail({ markOpened: true, role: actor.role, workorderId })
      .then((detail) => {
        if (actor.role === "office" || actor.role === "admin") {
          hydrateOfficeWorkorder(detail, { updateRoute: false });
          return;
        }
        hydrateOperationalWorkorder(detail, { updateRoute: false });
      })
      .catch(() => finishRoleWorkspace())
      .finally(() => setRouteLoading(false));
    // Initial URL hydration deliberately runs once for the authenticated actor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actor.id, actor.role, canManageDrafts]);
}

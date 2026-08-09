import { useCallback } from "react";

import { createDraftBaselineFromForm, resetWorkorderFormForCreate } from "./role-router-model.js";
import {
  createWorkorderSearch,
  defaultWorkspaceForRole,
  replaceRouteSearch,
  workspaceSearchForRole,
} from "./route-state.js";
import { todayIso } from "../../features/create-workorder/create-workorder-utils.js";

export function useRoleRouteNavigation({
  activeWorkorder,
  actor,
  createInitialDatesRef,
  createMode,
  draftMeaningful,
  resetVehicleLookup,
  setActiveWorkorder,
  setCreateAssignment,
  setCreateErrors,
  setCreateState,
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
}) {
  const openCreateWorkspace = useCallback(() => {
    const createDate = todayIso();
    workorderDraft.reset(null);
    setResumedDraft(null);
    setDraftLeaveOpen(false);
    setActiveWorkorder(null);
    resetVehicleLookup();
    setForm((current) => {
      const next = resetWorkorderFormForCreate(current, actor, createDate);
      createInitialDatesRef.current = createDraftBaselineFromForm(next);
      return next;
    });
    setPreviewPanelOpen(true);
    setDetailSource(null);
    setMode(createMode);
    setCreateErrors({});
    setCreateState({ busy: false, message: "" });
    setCreateAssignment((current) => ({ ...current, mechanicUserIds: [] }));
    setWorkspace("generator");
    replaceRouteSearch(createWorkorderSearch());
  }, [
    actor,
    createInitialDatesRef,
    createMode,
    resetVehicleLookup,
    setActiveWorkorder,
    setCreateAssignment,
    setCreateErrors,
    setCreateState,
    setDetailSource,
    setDraftLeaveOpen,
    setForm,
    setMode,
    setPreviewPanelOpen,
    setResumedDraft,
    setWorkspace,
    workorderDraft,
  ]);

  const finishRoleWorkspace = useCallback(() => {
    setDraftLeaveOpen(false);
    setDraftLeaveBusy(false);
    setActiveWorkorder(null);
    resetVehicleLookup();
    setPreviewPanelOpen(false);
    setDetailSource(null);
    setWorkspace(defaultWorkspaceForRole(actor.role));
    replaceRouteSearch(workspaceSearchForRole(actor.role));
  }, [
    actor.role,
    resetVehicleLookup,
    setActiveWorkorder,
    setDetailSource,
    setDraftLeaveBusy,
    setDraftLeaveOpen,
    setPreviewPanelOpen,
    setWorkspace,
  ]);

  const openRoleWorkspace = useCallback(() => {
    const leavingCreate = workspace === "generator" && !activeWorkorder;
    if (leavingCreate && (draftMeaningful || workorderDraft.draft?.id)) {
      setDraftLeaveOpen(true);
      return;
    }
    finishRoleWorkspace();
  }, [activeWorkorder, draftMeaningful, finishRoleWorkspace, setDraftLeaveOpen, workorderDraft.draft?.id, workspace]);

  return {
    finishRoleWorkspace,
    openCreateWorkspace,
    openRoleWorkspace,
  };
}

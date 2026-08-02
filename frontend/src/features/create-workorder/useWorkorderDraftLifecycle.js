import { useCallback, useEffect, useMemo, useState } from "react";

import { useDraftForm, useUnsavedBrowserGuard } from "../../components/drafts/index.js";
import { useAutomaticRefresh } from "../../hooks/useAutomaticRefresh.js";
import { api } from "../../lib/api.js";
import { createWorkorderSearch, currentRouteParams, replaceRouteSearch } from "../../app/routes/route-state.js";
import { buildWorkorderDraftPayload, isMeaningfulWorkorderDraft } from "../generator/workorder-draft.js";
import { formValuesFromWorkorderDraft } from "../generator/workorder-draft.js";
import {
  createWorkorderDraft,
  discardWorkorderDraft,
  updateWorkorderDraft,
} from "./workorder-draft-api.js";

export function useWorkorderDraftLifecycle({
  activeWorkorder,
  actor,
  canManageDrafts,
  form,
  initialBaseline,
  mechanicUserIds,
  selectedVehicle,
  restoreDraftVehicle,
  setActiveWorkorder,
  setCreateAssignment,
  setCreateState,
  setDetailSource,
  setForm,
  setMode,
  setPreviewPanelOpen,
  setWorkspace,
  workspace,
}) {
  const [resumedDraft, setResumedDraft] = useState(null);
  const [draftWorkspaceState, setDraftWorkspaceState] = useState({
    drafts: [],
    loading: false,
    error: "",
    busyId: "",
  });
  const [draftLeaveOpen, setDraftLeaveOpen] = useState(false);
  const [draftLeaveBusy, setDraftLeaveBusy] = useState(false);
  const payload = useMemo(() => buildWorkorderDraftPayload({
    actor,
    form,
    mechanicUserIds,
    selectedVehicle,
  }), [actor, form, mechanicUserIds, selectedVehicle]);
  const meaningful = workspace === "generator"
    && !activeWorkorder
    && canManageDrafts
    && isMeaningfulWorkorderDraft(payload, initialBaseline.current);
  const draft = useDraftForm({
    value: payload,
    meaningful,
    draft: resumedDraft,
    createDraft: createWorkorderDraft,
    updateDraft: updateWorkorderDraft,
    discardDraft: discardWorkorderDraft,
  });

  useUnsavedBrowserGuard({
    enabled: workspace === "generator" && !activeWorkorder,
    hasUnsyncedChanges: draft.hasUnsyncedChanges,
    flush: draft.flush,
    onFlushError: (error) => setCreateState({ busy: false, message: error.message }),
  });

  const loadDraftWorkspace = useCallback(async () => {
    if (!canManageDrafts) return;
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
      setDraftWorkspaceState((current) => ({ ...current, loading: false, error: error.message }));
    }
  }, [canManageDrafts]);

  useEffect(() => {
    if (!["office", "admin"].includes(workspace)) return;
    loadDraftWorkspace();
  }, [loadDraftWorkspace, workspace]);
  useAutomaticRefresh(loadDraftWorkspace, {
    enabled: canManageDrafts && ["office", "admin"].includes(workspace),
  });

  useEffect(() => {
    const draftId = draft.draft?.id;
    if (workspace !== "generator" || activeWorkorder || !draftId) return;
    if (currentRouteParams().get("draft") === draftId) return;
    replaceRouteSearch(createWorkorderSearch(draftId));
  }, [activeWorkorder, draft.draft?.id, workspace]);

  const restoreWorkorderDraft = useCallback((savedDraft) => {
    setForm((current) => formValuesFromWorkorderDraft(savedDraft.payload, current));
    setCreateAssignment((current) => ({
      ...current,
      mechanicUserIds: savedDraft.payload?.mechanicUserIds || [],
    }));
    restoreDraftVehicle(savedDraft.payload);
    setResumedDraft(savedDraft);
    draft.reset(savedDraft);
    setActiveWorkorder(null);
    setPreviewPanelOpen(true);
    setDetailSource(null);
    setMode("admin");
    setWorkspace("generator");
    setCreateState({ busy: false, message: "Draft restored." });
    replaceRouteSearch(createWorkorderSearch(savedDraft.id));
  }, [
    draft,
    restoreDraftVehicle,
    setActiveWorkorder,
    setCreateAssignment,
    setCreateState,
    setDetailSource,
    setForm,
    setMode,
    setPreviewPanelOpen,
    setWorkspace,
  ]);

  const openSavedDraft = useCallback(async (savedDraft) => {
    setDraftWorkspaceState((current) => ({ ...current, busyId: savedDraft.id, error: "" }));
    try {
      const result = await api(`/api/workorder-drafts/${encodeURIComponent(savedDraft.id)}`);
      restoreWorkorderDraft(result.draft);
    } catch (error) {
      setDraftWorkspaceState((current) => ({ ...current, error: error.message }));
    } finally {
      setDraftWorkspaceState((current) => ({ ...current, busyId: "" }));
    }
  }, [restoreWorkorderDraft]);

  const takeOverDraft = useCallback(async (savedDraft) => {
    setDraftWorkspaceState((current) => ({ ...current, busyId: savedDraft.id, error: "" }));
    try {
      const result = await api(`/api/workorder-drafts/${encodeURIComponent(savedDraft.id)}/takeover`, {
        method: "POST",
        body: JSON.stringify({ version: savedDraft.version }),
      });
      restoreWorkorderDraft(result.draft);
    } catch (error) {
      setDraftWorkspaceState((current) => ({ ...current, error: error.message }));
    } finally {
      setDraftWorkspaceState((current) => ({ ...current, busyId: "" }));
    }
  }, [restoreWorkorderDraft]);

  const discardDraftFromWorkspace = useCallback(async (savedDraft) => {
    setDraftWorkspaceState((current) => ({ ...current, busyId: savedDraft.id, error: "" }));
    try {
      await discardWorkorderDraft(savedDraft.id);
      await loadDraftWorkspace();
    } catch (error) {
      setDraftWorkspaceState((current) => ({ ...current, error: error.message }));
      throw error;
    } finally {
      setDraftWorkspaceState((current) => ({ ...current, busyId: "" }));
    }
  }, [loadDraftWorkspace]);

  return {
    draft,
    draftLeaveBusy,
    draftLeaveOpen,
    draftWorkspaceState,
    discardDraftFromWorkspace,
    loadDraftWorkspace,
    meaningful,
    openSavedDraft,
    payload,
    resumedDraft,
    restoreWorkorderDraft,
    setDraftLeaveBusy,
    setDraftLeaveOpen,
    setDraftWorkspaceState,
    setResumedDraft,
    takeOverDraft,
  };
}

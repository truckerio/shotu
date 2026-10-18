import { useEffect } from "react";
import { mechanicProgressRecoveryConflict, mechanicProgressRecoveryPatch } from "../../features/mechanic/progress/progress-storage.js";

import { useWorkorderDetailRealtime } from "../../features/workorder-detail/useWorkorderDetailRealtime.js";
import { canonicalPreviewTimes } from "../../features/workorder-detail/workorder-handoff.js";
import { api } from "../../lib/api.js";

export function useRoleRouterLifecycleEffects({
  activeWorkorder,
  actor,
  detailSource,
  form,
  isMechanicDetail,
  mechanicProgress,
  mechanicProgressBackupRestoredRef,
  reloadActiveWorkorder,
  setForm,
  setMapsConfig,
  setMechanicAction,
  setUsedPartsDirty,
  shouldPreserveActiveWorkorderForm,
  usedPartsDirty,
}) {
  useEffect(() => {
    const workorderId = activeWorkorder?.workorder?.id;
    const backup = mechanicProgress.backup;
    if (
      !isMechanicDetail
      || !(activeWorkorder?.allowedActions?.saveNotes || activeWorkorder?.allowedActions?.saveConcern)
      || !workorderId
      || !backup
      || mechanicProgressBackupRestoredRef.current === workorderId
    ) return;
    mechanicProgressBackupRestoredRef.current = workorderId;
    const currentVersion = activeWorkorder.workorder.progressVersion || 1;
    if (mechanicProgressRecoveryConflict(backup, currentVersion)) {
      setMechanicAction({ busy: "", message: `This workorder changed elsewhere. Unsaved work details are kept on this device for review.${backup.concern == null ? "" : ` Unsaved Concern: ${backup.concern}`}` });
      return;
    }
    const patch = mechanicProgressRecoveryPatch(backup, activeWorkorder.allowedActions, currentVersion);
    if (Object.entries(patch).every(([field, value]) => value === form[field])) return;
    setForm((current) => ({ ...current, ...patch }));
    setMechanicAction({
      busy: "",
      message: "Recovered unsaved work details from this device. They will sync automatically.",
    });
  }, [
    activeWorkorder?.allowedActions?.saveNotes,
    activeWorkorder?.allowedActions?.saveConcern,
    activeWorkorder?.workorder?.id,
    activeWorkorder?.workorder?.progressVersion,
    form.mechanicConcern,
    form.diagnosis,
    form.workPerformed,
    form.laborHours,
    isMechanicDetail,
    mechanicProgress.backup,
    mechanicProgressBackupRestoredRef,
    setForm,
    setMechanicAction,
  ]);

  useEffect(() => {
    const workorder = activeWorkorder?.workorder;
    if (!workorder) return;
    const canonicalTimes = canonicalPreviewTimes(workorder);
    setForm((current) => (
      current.startTime === canonicalTimes.startTime && current.endTime === canonicalTimes.endTime
        ? current
        : { ...current, ...canonicalTimes }
    ));
  }, [
    activeWorkorder?.workorder?.mechanicDoneAt,
    activeWorkorder?.workorder?.startedAt,
    setForm,
  ]);

  useEffect(() => {
    setUsedPartsDirty(false);
  }, [activeWorkorder?.workorder?.id, setUsedPartsDirty]);

  useEffect(() => {
    api("/api/config")
      .then((result) => setMapsConfig(result.maps || {}))
      .catch(() => setMapsConfig({}));
  }, [setMapsConfig]);

  useWorkorderDetailRealtime({
    enabled: Boolean(activeWorkorder?.workorder?.id && ["office", "mechanic"].includes(detailSource)),
    workorderId: activeWorkorder?.workorder?.id,
    paused: isMechanicDetail
      && (mechanicProgress.hasUnsyncedChanges || mechanicProgress.status === "saving"),
    onRefresh: () => reloadActiveWorkorder({
      preserveForm: usedPartsDirty || shouldPreserveActiveWorkorderForm(),
    }),
  });
}

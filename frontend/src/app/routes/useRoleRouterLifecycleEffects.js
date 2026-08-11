import { useEffect } from "react";

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
    paused: usedPartsDirty || (
      isMechanicDetail
      && (mechanicProgress.hasUnsyncedChanges || mechanicProgress.status === "saving")
    ),
    onRefresh: () => reloadActiveWorkorder({ preserveForm: shouldPreserveActiveWorkorderForm() }),
  });
}

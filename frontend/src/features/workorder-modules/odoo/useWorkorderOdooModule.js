import { useCallback, useEffect, useState } from "react";
import { api } from "../../../lib/api.js";
import { odooDraftBlockedMessage } from "./workorder-odoo-model.js";

function moduleEndpoint(workorderId, action) {
  return `/api/workorders/${encodeURIComponent(workorderId)}/modules/odoo/${action}`;
}

export function useWorkorderOdooModule({
  enabled,
  eligible,
  onDetailRefresh,
  onDraftCreated,
  onMissingInfo,
  reportError,
  workorderId,
}) {
  const [laborHours, setLaborHours] = useState("");
  const [odooDraftFeedback, setOdooDraftFeedback] = useState("");
  const [odooDraftResult, setOdooDraftResult] = useState(null);
  const [odooLoading, setOdooLoading] = useState(false);
  const [odooNote, setOdooNote] = useState("");
  const [odooReadiness, setOdooReadiness] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const fail = useCallback((cause) => {
    const message = cause?.message || "The Odoo request could not be completed.";
    setError(message);
    reportError?.(message);
  }, [reportError]);

  const loadOdooReadiness = useCallback(async ({ fillLaborHours = false } = {}) => {
    if (!enabled || !eligible || !workorderId) return null;
    setOdooLoading(true);
    try {
      const readiness = await api(moduleEndpoint(workorderId, "readiness"));
      setOdooReadiness(readiness);
      if (readiness?.ready) setOdooDraftFeedback("");
      if (fillLaborHours && readiness?.labor?.hours) setLaborHours(String(readiness.labor.hours));
      return readiness;
    } catch (cause) {
      fail(cause);
      return null;
    } finally {
      setOdooLoading(false);
    }
  }, [eligible, enabled, fail, workorderId]);

  useEffect(() => {
    setLaborHours("");
    setOdooDraftFeedback("");
    setOdooDraftResult(null);
    setOdooNote("");
    setOdooReadiness(null);
    setError("");
    if (enabled && eligible && workorderId) loadOdooReadiness({ fillLaborHours: true });
  }, [eligible, enabled, loadOdooReadiness, workorderId]);

  async function createOdooDraft(event) {
    event?.preventDefault?.();
    if (!enabled || !eligible || !workorderId || !String(laborHours).trim()) return;
    setSaving(true);
    setError("");
    setOdooDraftFeedback("");
    try {
      await api(moduleEndpoint(workorderId, "preparation"), {
        method: "PUT",
        body: JSON.stringify({ laborHours: String(laborHours).trim() }),
      });
      const readiness = await loadOdooReadiness();
      if (!readiness?.ready) {
        setOdooDraftFeedback(odooDraftBlockedMessage(readiness));
        return;
      }
      const result = await api(moduleEndpoint(workorderId, "draft"), {
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: readiness.workorder?.updatedAt }),
      });
      setOdooDraftResult(result);
      await onDraftCreated?.(result);
      await onDetailRefresh?.();
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  }

  async function markMissingInfo() {
    if (!enabled || !eligible || !workorderId || !odooNote.trim()) return;
    setSaving(true);
    setError("");
    try {
      await api(moduleEndpoint(workorderId, "missing-info"), {
        method: "POST",
        body: JSON.stringify({ note: odooNote.trim() }),
      });
      setOdooNote("");
      if (onMissingInfo) await onMissingInfo();
      else await onDetailRefresh?.();
    } catch (cause) {
      fail(cause);
    } finally {
      setSaving(false);
    }
  }

  return {
    createOdooDraft,
    error,
    laborHours,
    loadOdooReadiness,
    markMissingInfo,
    odooDraftFeedback,
    odooDraftResult,
    odooLoading,
    odooNote,
    odooReadiness,
    saving,
    setLaborHours,
    setOdooNote,
  };
}

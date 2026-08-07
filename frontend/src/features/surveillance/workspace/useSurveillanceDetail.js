import { useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { useWorkorderDetailRealtime } from "../../workorder-detail/useWorkorderDetailRealtime.js";
import { odooDraftBlockedMessage } from "./surveillance-workspace-model.js";

export function useSurveillanceDetail({ activeTab, loadDashboard, rows, setError }) {
  const [detail, setDetail] = useState(null);
  const [detailSection, setDetailSection] = useState("work");
  const [previewOpen, setPreviewOpen] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 760));
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [odooReadiness, setOdooReadiness] = useState(null);
  const [odooDraftResult, setOdooDraftResult] = useState(null);
  const [odooDraftFeedback, setOdooDraftFeedback] = useState("");
  const [laborHours, setLaborHours] = useState("");
  const [odooNote, setOdooNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [odooLoading, setOdooLoading] = useState(false);
  const previewRef = useRef(null);

  async function loadOdooReadiness(workorderId, { fillLaborHours = false } = {}) {
    if (!workorderId) return null;
    setOdooLoading(true);
    try {
      const readiness = await api(`/api/surveillance/workorders/${encodeURIComponent(workorderId)}/odoo-readiness`);
      setOdooReadiness(readiness);
      if (readiness?.ready) setOdooDraftFeedback("");
      if (fillLaborHours && readiness?.labor?.hours) setLaborHours(String(readiness.labor.hours));
      return readiness;
    } finally {
      setOdooLoading(false);
    }
  }

  async function openWorkorder(id) {
    setError("");
    try {
      const nextDetail = await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`);
      setDetail(nextDetail);
      setDetailSection("work");
      setFullscreenPageIndex(0);
      setOdooReadiness(null);
      setOdooDraftResult(null);
      setOdooDraftFeedback("");
      setLaborHours("");
      setOdooNote("");
      if (["closed", "odoo_entered"].includes(nextDetail?.workorder?.status)) {
        await loadOdooReadiness(id, { fillLaborHours: true });
      }
    } catch (openError) {
      setError(openError.message);
    }
  }

  useWorkorderDetailRealtime({
    enabled: Boolean(detail?.workorder?.id),
    workorderId: detail?.workorder?.id,
    paused: saving,
    onRefresh: async () => {
      const refreshed = await api(`/api/surveillance/workorders/${encodeURIComponent(detail.workorder.id)}`);
      setDetail(refreshed);
      if (["closed", "odoo_entered"].includes(refreshed?.workorder?.status)) {
        await loadOdooReadiness(refreshed.workorder.id);
      }
    },
  });

  function openRelative(offset) {
    const currentIndex = rows.findIndex((row) => row.id === detail?.workorder?.id);
    const next = rows[currentIndex + offset];
    if (next) openWorkorder(next.id);
  }

  function togglePreview() {
    if (typeof window !== "undefined" && window.innerWidth <= 760) {
      setPreviewFullscreen(true);
      return;
    }
    setPreviewOpen((open) => !open);
  }

  async function finishAndAdvance(request) {
    setSaving(true);
    setError("");
    const currentId = detail?.workorder?.id;
    const currentIndex = rows.findIndex((row) => row.id === currentId);
    try {
      await request(currentId);
      const nextDashboard = await loadDashboard();
      const nextRows = nextDashboard?.[activeTab] || [];
      const next = nextRows[Math.min(currentIndex, Math.max(0, nextRows.length - 1))];
      if (next && next.id !== currentId) await openWorkorder(next.id);
      else setDetail(null);
      setOdooReadiness(null);
      setOdooDraftResult(null);
      setOdooDraftFeedback("");
      setLaborHours("");
      setOdooNote("");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function createOdooDraft(event) {
    event.preventDefault();
    if (!detail?.workorder?.id || !String(laborHours).trim()) return;
    setSaving(true);
    setError("");
    setOdooDraftFeedback("");
    try {
      const id = detail.workorder.id;
      await api(`/api/surveillance/workorders/${encodeURIComponent(id)}/odoo-preparation`, {
        method: "PUT",
        body: JSON.stringify({ laborHours: String(laborHours).trim() }),
      });
      const readiness = await loadOdooReadiness(id);
      if (!readiness?.ready) {
        setOdooDraftFeedback(odooDraftBlockedMessage(readiness));
        return;
      }
      const result = await api(`/api/surveillance/workorders/${encodeURIComponent(id)}/odoo-draft`, {
        method: "POST",
        body: JSON.stringify({ expectedUpdatedAt: readiness.workorder?.updatedAt }),
      });
      setOdooDraftResult(result);
      await loadDashboard();
      setDetail(await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`));
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function markMissingInfo() {
    if (!detail?.workorder?.id || !odooNote.trim()) return;
    finishAndAdvance((id) => api(`/api/surveillance/workorders/${encodeURIComponent(id)}/mark-missing-info`, {
      method: "POST",
      body: JSON.stringify({ note: odooNote.trim() }),
    }));
  }

  return {
    closeDetail: () => setDetail(null),
    detail,
    detailSection,
    fullscreenPageIndex,
    fullscreenZoom,
    createOdooDraft,
    laborHours,
    markMissingInfo,
    odooDraftResult,
    odooDraftFeedback,
    odooLoading,
    odooNote,
    odooReadiness,
    openRelative,
    openWorkorder,
    previewFullscreen,
    previewOpen,
    previewRef,
    saving,
    setDetailSection,
    setFullscreenPageIndex,
    setFullscreenZoom,
    setLaborHours,
    setOdooNote,
    setPreviewFullscreen,
    togglePreview,
  };
}

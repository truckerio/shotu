import { useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { useWorkorderDetailRealtime } from "../../workorder-detail/useWorkorderDetailRealtime.js";

export function useSurveillanceDetail({ activeTab, loadDashboard, rows, setError }) {
  const [detail, setDetail] = useState(null);
  const [detailSection, setDetailSection] = useState("work");
  const [previewOpen, setPreviewOpen] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 760));
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [odooServiceOrderNo, setOdooServiceOrderNo] = useState("");
  const [odooNote, setOdooNote] = useState("");
  const [saving, setSaving] = useState(false);
  const previewRef = useRef(null);

  async function openWorkorder(id) {
    setError("");
    try {
      setDetail(await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`));
      setDetailSection("work");
      setFullscreenPageIndex(0);
      setOdooServiceOrderNo("");
      setOdooNote("");
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
      setOdooServiceOrderNo("");
      setOdooNote("");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  function markEntered(event) {
    event.preventDefault();
    if (!detail?.workorder?.id || !odooServiceOrderNo.trim()) return;
    finishAndAdvance((id) => api(`/api/surveillance/workorders/${encodeURIComponent(id)}/mark-odoo-entered`, {
      method: "POST",
      body: JSON.stringify({ odooServiceOrderNo: odooServiceOrderNo.trim(), note: odooNote.trim() }),
    }));
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
    markEntered,
    markMissingInfo,
    odooNote,
    odooServiceOrderNo,
    openRelative,
    openWorkorder,
    previewFullscreen,
    previewOpen,
    previewRef,
    saving,
    setDetailSection,
    setFullscreenPageIndex,
    setFullscreenZoom,
    setOdooNote,
    setOdooServiceOrderNo,
    setPreviewFullscreen,
    togglePreview,
  };
}

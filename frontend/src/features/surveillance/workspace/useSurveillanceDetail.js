import { useRef, useState } from "react";
import { api } from "../../../lib/api.js";
import { useWorkorderDetailRealtime } from "../../workorder-detail/useWorkorderDetailRealtime.js";
import { useWorkorderOdooModule } from "../../workorder-modules/odoo/useWorkorderOdooModule.js";
import { isWorkorderOdooEligible } from "../../workorder-modules/odoo/workorder-odoo-model.js";

export function useSurveillanceDetail({ activeTab, loadDashboard, rows, setError }) {
  const [detail, setDetail] = useState(null);
  const [detailSection, setDetailSection] = useState("work");
  const [previewOpen, setPreviewOpen] = useState(() => (typeof window === "undefined" ? true : window.innerWidth > 760));
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const previewRef = useRef(null);

  async function refreshDetail() {
    const id = detail?.workorder?.id;
    if (!id) return;
    setDetail(await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`));
  }

  async function openWorkorder(id) {
    setError("");
    try {
      const nextDetail = await api(`/api/surveillance/workorders/${encodeURIComponent(id)}`);
      setDetail(nextDetail);
      setDetailSection("work");
      setFullscreenPageIndex(0);
      setFullscreenZoom(1);
    } catch (openError) {
      setError(openError.message);
    }
  }

  async function advanceAfterMissingInfo() {
    const currentId = detail?.workorder?.id;
    const currentIndex = rows.findIndex((row) => row.id === currentId);
    const nextDashboard = await loadDashboard();
    const nextRows = nextDashboard?.[activeTab] || [];
    const next = nextRows[Math.min(currentIndex, Math.max(0, nextRows.length - 1))];
    if (next && next.id !== currentId) await openWorkorder(next.id);
    else setDetail(null);
  }

  const odooModule = useWorkorderOdooModule({
    enabled: Boolean(detail?.workorder?.id),
    eligible: isWorkorderOdooEligible(detail?.workorder?.status),
    onDetailRefresh: refreshDetail,
    onDraftCreated: loadDashboard,
    onMissingInfo: advanceAfterMissingInfo,
    reportError: setError,
    workorderId: detail?.workorder?.id,
  });

  useWorkorderDetailRealtime({
    enabled: Boolean(detail?.workorder?.id),
    workorderId: detail?.workorder?.id,
    paused: odooModule.saving,
    onRefresh: async () => {
      const refreshed = await api(`/api/surveillance/workorders/${encodeURIComponent(detail.workorder.id)}`);
      setDetail(refreshed);
      if (isWorkorderOdooEligible(refreshed?.workorder?.status)) await odooModule.loadOdooReadiness();
    },
  });

  function openRelative(offset) {
    const currentIndex = rows.findIndex((row) => row.id === detail?.workorder?.id);
    const next = rows[currentIndex + offset];
    if (next) openWorkorder(next.id);
  }

  function togglePreview() {
    if (typeof window !== "undefined" && window.innerWidth <= 760) {
      setFullscreenPageIndex(0);
      setFullscreenZoom(1);
      setPreviewFullscreen(true);
      return;
    }
    setPreviewOpen((open) => !open);
  }

  return {
    closeDetail: () => setDetail(null),
    detail,
    detailSection,
    fullscreenPageIndex,
    fullscreenZoom,
    ...odooModule,
    openRelative,
    openWorkorder,
    previewFullscreen,
    previewOpen,
    previewRef,
    setDetailSection,
    setFullscreenPageIndex,
    setFullscreenZoom,
    setPreviewFullscreen,
    togglePreview,
  };
}

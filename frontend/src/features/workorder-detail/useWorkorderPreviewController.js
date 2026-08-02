import { useCallback, useEffect, useState } from "react";
import { replaceRouteSearch, workorderDetailSearch } from "../../app/routes/route-state.js";
import { defaultDetailSection } from "./workorder-detail-sections.js";

const PHONE_QUERY = "(max-width: 700px)";
const COMPACT_QUERY = "(max-width: 1180px)";

function matchesMedia(query) {
  return typeof window === "undefined" ? false : window.matchMedia(query).matches;
}

export function useWorkorderPreviewController({
  activeWorkorder,
  actorRole,
  closePrintMenu = () => {},
  detailSection,
  detailStatus,
  effectiveCopies,
  isMechanicDetail,
  isWorkorderDetail,
  previewSerialCount,
  setDetailSection,
}) {
  const [previewPanelOpen, setPreviewPanelOpen] = useState(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [fullscreenPageIndex, setFullscreenPageIndex] = useState(0);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const [isPhone, setIsPhone] = useState(() => matchesMedia(PHONE_QUERY));
  const [isCompact, setIsCompact] = useState(() => matchesMedia(COMPACT_QUERY));
  const [supportingView, setSupportingView] = useState("preview");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const phoneQuery = window.matchMedia(PHONE_QUERY);
    const compactQuery = window.matchMedia(COMPACT_QUERY);
    const syncPhone = () => setIsPhone(phoneQuery.matches);
    const syncCompact = () => setIsCompact(compactQuery.matches);
    syncPhone();
    syncCompact();
    phoneQuery.addEventListener("change", syncPhone);
    compactQuery.addEventListener("change", syncCompact);
    return () => {
      phoneQuery.removeEventListener("change", syncPhone);
      compactQuery.removeEventListener("change", syncCompact);
    };
  }, []);

  useEffect(() => {
    if (!activeWorkorder || actorRole === "mechanic" || isCompact || detailSection !== "chat") return;
    setSupportingView("chat");
    setDetailSection(defaultDetailSection(actorRole, detailStatus, false));
  }, [activeWorkorder, actorRole, detailSection, detailStatus, isCompact, setDetailSection]);

  useEffect(() => {
    if (!activeWorkorder || isCompact || detailSection !== "preview") return;
    setSupportingView("preview");
    setPreviewPanelOpen(true);
    setDetailSection(defaultDetailSection(actorRole, detailStatus, false));
  }, [activeWorkorder, actorRole, detailSection, detailStatus, isCompact, setDetailSection]);

  useEffect(() => {
    setFullscreenPageIndex((current) => Math.min(current, Math.max(0, effectiveCopies - 1)));
  }, [effectiveCopies]);

  useEffect(() => {
    if (!previewFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event) => {
      if (event.key === "Escape") setPreviewFullscreen(false);
      if (event.key === "ArrowLeft") setFullscreenPageIndex((current) => Math.max(0, current - 1));
      if (event.key === "ArrowRight") {
        setFullscreenPageIndex((current) => Math.min(Math.max(0, previewSerialCount - 1), current + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewFullscreen, previewSerialCount]);

  useEffect(() => {
    if (!previewPanelOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setPreviewPanelOpen(false);
        closePrintMenu();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closePrintMenu, previewPanelOpen]);

  const jumpToPreview = useCallback(() => {
    if (isWorkorderDetail && isCompact) {
      setFullscreenPageIndex(0);
      setFullscreenZoom(isPhone ? 0 : 1);
      setPreviewFullscreen(true);
      return;
    }
    if (supportingView !== "preview" || !previewPanelOpen) {
      setSupportingView("preview");
      setPreviewPanelOpen(true);
      return;
    }
    setPreviewPanelOpen((open) => {
      if (open) closePrintMenu();
      return !open;
    });
  }, [closePrintMenu, isCompact, isPhone, isWorkorderDetail, previewPanelOpen, supportingView]);

  const toggleWorkorderTools = useCallback(() => {
    if (isCompact) {
      jumpToPreview();
      return;
    }
    setPreviewPanelOpen((open) => !open);
    closePrintMenu();
  }, [closePrintMenu, isCompact, jumpToPreview]);

  const selectDetailSection = useCallback((section) => {
    const workorderId = activeWorkorder?.workorder?.id;
    if (section === "preview" && !isCompact) {
      setSupportingView("preview");
      setPreviewPanelOpen(true);
      if (detailSection === "preview") {
        setDetailSection(defaultDetailSection(actorRole, detailStatus, false));
      }
      if (workorderId) replaceRouteSearch(workorderDetailSearch(workorderId, "preview"));
      return;
    }
    if (section === "chat" && !isCompact && !isMechanicDetail) {
      setSupportingView("chat");
      setPreviewPanelOpen(true);
      if (workorderId) replaceRouteSearch(workorderDetailSearch(workorderId, "chat"));
      return;
    }
    setDetailSection(section);
    if (workorderId) replaceRouteSearch(workorderDetailSearch(workorderId, section));
  }, [
    activeWorkorder?.workorder?.id,
    actorRole,
    detailSection,
    detailStatus,
    isCompact,
    isMechanicDetail,
    setDetailSection,
  ]);

  const openFullscreenPreview = useCallback(() => {
    closePrintMenu();
    setFullscreenPageIndex(0);
    setFullscreenZoom(isPhone ? 0 : 1);
    setPreviewFullscreen(true);
  }, [closePrintMenu, isPhone]);

  return {
    fullscreenPageIndex,
    fullscreenZoom,
    isCompact,
    isPhone,
    openFullscreenPreview,
    previewFullscreen,
    previewPanelOpen,
    selectDetailSection,
    setFullscreenPageIndex,
    setFullscreenZoom,
    setPreviewFullscreen,
    setPreviewPanelOpen,
    setSupportingView,
    supportingView,
    toggleWorkorderTools,
    jumpToPreview,
  };
}

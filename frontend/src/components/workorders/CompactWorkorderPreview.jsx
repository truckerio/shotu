import { useCallback, useLayoutEffect, useRef } from "react";
import { PreviewPane } from "../preview/PreviewPane.jsx";
import { compactPreviewDocumentScale } from "./compact-preview-geometry.js";

export function CompactWorkorderPreview({
  children,
  countLabel,
  onFullscreen,
  onOpenPreview = onFullscreen,
  panelRef,
  primaryActionLabel,
  printMenuOpen,
  range,
  status,
  onPrint,
  onTogglePrintMenu,
  previewState = { status: "ready", message: "" },
  locale = "en",
}) {
  const internalPanelRef = useRef(null);

  useLayoutEffect(() => {
    const panel = internalPanelRef.current;
    if (!panel) return undefined;
    const shells = [...panel.querySelectorAll(".workorder-preview-shell")];
    const updateScale = (shell) => {
      const width = shell.getBoundingClientRect().width;
      shell.style.setProperty("--workorder-preview-scale", String(compactPreviewDocumentScale(width)));
    };
    shells.forEach(updateScale);
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => updateScale(entry.target));
    });
    shells.forEach((shell) => observer.observe(shell));
    return () => observer.disconnect();
  }, [children, previewState.status]);

  const setPanelRef = useCallback((node) => {
    internalPanelRef.current = node;
    if (typeof panelRef === "function") panelRef(node);
    else if (panelRef) panelRef.current = node;
  }, [panelRef]);

  return (
    <div className="workorder-compact-preview">
      <PreviewPane
        id="workorder-preview-panel"
        open
        variant="dock"
        panelRef={setPanelRef}
        status={status}
        countLabel={countLabel}
        range={range}
        printMenuOpen={printMenuOpen}
        onTogglePrintMenu={onTogglePrintMenu}
        onPrint={onPrint}
        primaryActionLabel={primaryActionLabel}
        onFullscreen={onFullscreen}
        onOpenPreview={onOpenPreview}
        locale={locale}
      >
        {previewState.status === "ready"
          ? children
          : <div className={`workorder-preview-state is-${previewState.status}`} role="status">{previewState.message}</div>}
      </PreviewPane>
    </div>
  );
}

import { PreviewPane } from "../preview/PreviewPane.jsx";

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
}) {
  return (
    <div className="workorder-compact-preview">
      <PreviewPane
        id="workorder-preview-panel"
        open
        variant="dock"
        panelRef={panelRef}
        status={status}
        countLabel={countLabel}
        range={range}
        printMenuOpen={printMenuOpen}
        onTogglePrintMenu={onTogglePrintMenu}
        onPrint={onPrint}
        primaryActionLabel={primaryActionLabel}
        onFullscreen={onFullscreen}
        onOpenPreview={onOpenPreview}
      >
        {previewState.status === "ready"
          ? children
          : <div className={`workorder-preview-state is-${previewState.status}`} role="status">{previewState.message}</div>}
      </PreviewPane>
    </div>
  );
}

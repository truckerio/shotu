import React from "react";
import { Expand01, FileSearch01, LayoutRight, MessageChatCircle, Printer } from "@untitledui/icons";

export function PreviewToggle({
  open,
  onToggle,
  controls,
  className = "",
  openLabel = "Open preview",
  closeLabel = "Close preview",
}) {
  const label = open ? closeLabel : openLabel;

  return (
    <button
      className={`preview-pane-toggle icon-tooltip ${open ? "is-open" : "is-closed"} ${className}`.trim()}
      type="button"
      onClick={onToggle}
      aria-controls={controls}
      aria-expanded={open}
      aria-label={label}
      data-tooltip={label}
    >
      <LayoutRight />
    </button>
  );
}

export function PreviewPane({
  id,
  open,
  variant = "full",
  status,
  countLabel,
  range,
  onFullscreen,
  onOpenPreview,
  printMenuOpen,
  onTogglePrintMenu,
  onPrint,
  primaryActionLabel,
  batchSettings,
  secondaryContent,
  supportingContent,
  supportingLabel = "Chat",
  supportingCount,
  supportingAttention = false,
  activeView = "preview",
  onViewChange,
  children,
  panelRef,
}) {
  const isDock = variant === "dock";
  const hasSupportingView = isDock && Boolean(supportingContent) && Boolean(onViewChange);
  const previewVisible = !hasSupportingView || activeView === "preview";
  const openPreview = () => {
    if (previewVisible && isDock && onOpenPreview) onOpenPreview();
  };

  const handlePreviewKeyDown = (event) => {
    if (!previewVisible || !isDock || !onOpenPreview || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onOpenPreview();
  };

  return (
    <section
      className={`preview-panel global-preview-pane ${isDock ? "is-dock" : "is-full"} ${secondaryContent ? "has-secondary" : ""} ${hasSupportingView ? "has-supporting-view" : ""} ${open ? "is-open" : "is-closed"}`.trim()}
      id={id}
      ref={panelRef}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="preview-header">
        {hasSupportingView ? (
          <div className="supporting-pane-tabs" role="tablist" aria-label="Workorder tools">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "chat"}
              className={`${activeView === "chat" ? "is-active" : ""} ${supportingAttention ? "has-attention" : ""}`.trim()}
              onClick={() => onViewChange("chat")}
            >
              <MessageChatCircle />
              <span>{supportingLabel}</span>
              {supportingCount ? <small>{supportingCount}</small> : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === "preview"}
              className={activeView === "preview" ? "is-active" : ""}
              onClick={() => onViewChange("preview")}
            >
              <FileSearch01 />
              <span>Preview</span>
            </button>
          </div>
        ) : (
          <div className="preview-title-row">
            <h2>Preview</h2>
            {status}
          </div>
        )}

        {previewVisible ? <div className="preview-header-actions">
          <div className="preview-summary" aria-label="Preview range">
            <span>{countLabel}</span>
            <strong>{range}</strong>
          </div>

          {onPrint ? <div className="preview-print-command">
            <button
              className="preview-tool-button icon-tooltip"
              type="button"
              onClick={onTogglePrintMenu}
              aria-expanded={printMenuOpen}
              aria-haspopup="menu"
              aria-label={primaryActionLabel}
              data-tooltip={printMenuOpen ? "" : primaryActionLabel}
            >
              <Printer />
            </button>
            {printMenuOpen ? (
              <div
                className="print-command-menu"
                role="menu"
                onKeyDown={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  onTogglePrintMenu?.();
                }}
              >
                <button className="print-command-run" type="button" role="menuitem" onClick={onPrint}>
                  <span>{primaryActionLabel}</span>
                  <small>Choose a printer or Save as PDF in your browser</small>
                </button>
                {batchSettings ? (
                  <div className="print-batch-settings" role="group" aria-label="Batch print settings">
                    <div>
                      <span>Batch size</span>
                      <small>Each workorder gets a unique serial</small>
                    </div>
                    <label>
                      Workorders
                      <input type="number" min="1" max="250" value={batchSettings.copies} onChange={(event) => batchSettings.onChange("copies", event.target.value)} />
                    </label>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div> : null}

          <button
            className="preview-tool-button icon-tooltip"
            type="button"
            onClick={onFullscreen}
            aria-label="Open fullscreen preview"
            data-tooltip="Fullscreen"
          >
            <Expand01 />
          </button>
        </div> : <div className="supporting-pane-status">{status}</div>}
      </div>

      {previewVisible ? (
        <div
          className="preview-pane-content"
          role={isDock && onOpenPreview ? "button" : undefined}
          tabIndex={open && isDock && onOpenPreview ? 0 : undefined}
          aria-label={isDock && onOpenPreview ? "Open fullscreen workorder preview" : undefined}
          onClick={openPreview}
          onKeyDown={handlePreviewKeyDown}
        >
          {children}
        </div>
      ) : (
        <div className="supporting-pane-content" role="tabpanel" aria-label={supportingLabel}>
          {supportingContent}
        </div>
      )}

      {secondaryContent ? <div className="preview-secondary-pane">{secondaryContent}</div> : null}
    </section>
  );
}

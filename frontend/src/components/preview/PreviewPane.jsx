import React from "react";
import { Expand01, LayoutRight, Printer } from "@untitledui/icons";

export function PreviewToggle({ open, onToggle, controls, className = "" }) {
  const label = open ? "Close preview" : "Open preview";

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
  selectedDestinationLabel,
  printerName,
  printers,
  onSelectPrintDestination,
  batchSettings,
  secondaryContent,
  children,
  panelRef,
}) {
  const isDock = variant === "dock";
  const openPreview = () => {
    if (isDock && onOpenPreview) onOpenPreview();
  };

  const handlePreviewKeyDown = (event) => {
    if (!isDock || !onOpenPreview || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onOpenPreview();
  };

  return (
    <section
      className={`preview-panel global-preview-pane ${isDock ? "is-dock" : "is-full"} ${secondaryContent ? "has-secondary" : ""} ${open ? "is-open" : "is-closed"}`.trim()}
      id={id}
      ref={panelRef}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="preview-header">
        <div className="preview-title-row">
          <h2>Preview</h2>
          {status}
        </div>

        <div className="preview-header-actions">
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
              <div className="print-command-menu" role="menu">
                <button className="print-command-run" type="button" role="menuitem" onClick={onPrint}>
                  <span>{primaryActionLabel}</span>
                  <small>{selectedDestinationLabel}</small>
                </button>
                {batchSettings ? (
                  <div className="print-batch-settings" role="group" aria-label="Batch print settings">
                    <div>
                      <span>Blank workorders</span>
                      <small>Serials are reserved automatically</small>
                    </div>
                    <label>
                      Copies
                      <input type="number" min="1" max="250" value={batchSettings.copies} onChange={(event) => batchSettings.onChange("copies", event.target.value)} />
                    </label>
                  </div>
                ) : null}
                <button type="button" role="menuitem" onClick={() => onSelectPrintDestination("")}>
                  <span>{printerName ? "Switch to PDF" : "Selected"}</span>
                  <small>Save PDF only</small>
                </button>
                {printers.map((printer) => (
                  <button key={printer.name} type="button" role="menuitem" onClick={() => onSelectPrintDestination(printer.name)}>
                    <span>{printerName === printer.name ? "Selected" : "Use printer"}</span>
                    <small>{printer.isDefault ? `${printer.name} (default)` : printer.name}</small>
                  </button>
                ))}
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
        </div>
      </div>

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

      {secondaryContent ? <div className="preview-secondary-pane">{secondaryContent}</div> : null}
    </section>
  );
}

import { memo } from "react";
import { CheckCircle, ChevronLeft, ChevronRight, Printer, XClose, ZoomIn, ZoomOut } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import {
  paginateWorkorderParts,
  renderWorkorderBatchPagesHtml,
  renderWorkorderPageHtml,
  WORKORDER_PART_ROWS_PER_PAGE,
} from "../../../../shared/workorder-template.js";

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export const WorkorderPreview = memo(function WorkorderPreview({ serial, label, form, pageIndex = 0 }) {
  const pages = paginateWorkorderParts(form);
  const safePageIndex = Math.min(Math.max(pageIndex, 0), pages.length - 1);
  return (
    <div className="preview-page-card">
      <div className="preview-page-meta"><span>{label}</span><strong>{serial}</strong></div>
      <div className="workorder-preview-shell"><div dangerouslySetInnerHTML={{
        __html: renderWorkorderPageHtml(form, serial, {
          rows: pages[safePageIndex],
          pageIndex: safePageIndex,
          pageCount: pages.length,
          rowOffset: safePageIndex * WORKORDER_PART_ROWS_PER_PAGE,
        }),
      }} /></div>
    </div>
  );
});

export function BrowserPrintDocument({ payload }) {
  if (!payload?.serials?.length) return null;
  return (
    <section
      className="browser-print-document"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: renderWorkorderBatchPagesHtml(payload.form, payload.serials) }}
    />
  );
}

export function PreviewFullscreen({ open, form, serials, pageIndex, zoom, range, countLabel, actionLabel, onClose, onPageChange, onZoomChange, onPrint }) {
  if (!open) return null;
  const physicalPages = serials.flatMap((serial) => {
    const pages = paginateWorkorderParts(form);
    return pages.map((rows, physicalPageIndex) => ({
      serial,
      rows,
      pageIndex: physicalPageIndex,
      pageCount: pages.length,
      rowOffset: physicalPageIndex * WORKORDER_PART_ROWS_PER_PAGE,
    }));
  });
  const safeIndex = Math.min(Math.max(pageIndex, 0), physicalPages.length - 1);
  const physicalPage = physicalPages[safeIndex];
  const serial = physicalPage?.serial || "";
  const canGoBack = safeIndex > 0;
  const canGoForward = safeIndex < physicalPages.length - 1;

  return (
    <div className="preview-fullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen workorder preview">
      <div className="preview-fullscreen-toolbar">
        <div className="fullscreen-title"><strong>Preview</strong><span>{countLabel} / {range}</span></div>
        <div className="fullscreen-toolbox" aria-label="Preview tools">
          <button className="icon-tooltip" type="button" onClick={() => onPageChange(safeIndex - 1)} disabled={!canGoBack} aria-label="Previous page" data-tooltip="Previous page"><ChevronLeft /></button>
          <span className="fullscreen-page-count">{safeIndex + 1} / {physicalPages.length}</span>
          <button className="icon-tooltip" type="button" onClick={() => onPageChange(safeIndex + 1)} disabled={!canGoForward} aria-label="Next page" data-tooltip="Next page"><ChevronRight /></button>
          <button className="icon-tooltip" type="button" onClick={() => onZoomChange(Math.max(0, zoom - 1))} disabled={zoom <= 0} aria-label="Zoom out" data-tooltip="Zoom out"><ZoomOut /></button>
          <button className="icon-tooltip" type="button" onClick={() => onZoomChange(Math.min(2, zoom + 1))} disabled={zoom >= 2} aria-label="Zoom in" data-tooltip="Zoom in"><ZoomIn /></button>
          {onPrint ? <button className="fullscreen-print icon-tooltip" type="button" onClick={onPrint} aria-label={actionLabel} data-tooltip={actionLabel}><Printer /></button> : null}
          <button className="icon-tooltip" type="button" onClick={onClose} aria-label="Close fullscreen preview" data-tooltip="Close"><XClose /></button>
        </div>
      </div>
      <div className={`fullscreen-stage zoom-${zoom}`}>
        <div className="fullscreen-page-meta"><span>Page {safeIndex + 1}</span><strong>{serial}</strong></div>
        <div className="fullscreen-page-wrap"><div className="workorder-preview-shell"><div dangerouslySetInnerHTML={{
          __html: renderWorkorderPageHtml(form, serial, physicalPage),
        }} /></div></div>
      </div>
    </div>
  );
}

export function PrintModal({ state, range, onClose }) {
  if (!state.open) return null;
  const isDone = state.stage === "done";
  const isError = state.stage === "error";
  const displayRange = state.range || range;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="print-modal">
        <button className="close-button" type="button" onClick={onClose} aria-label="Close print status"><XClose /></button>
        <div className={`modal-icon ${isDone ? "done" : isError ? "error" : ""}`}>{isDone ? <CheckCircle /> : <Printer />}</div>
        <h2>{isDone ? "Print job ready" : isError ? "Print failed" : "Archiving print job"}</h2>
        <p>{state.message}</p>
        <div className="print-summary">
          <div><span>{displayRange.includes(" to ") ? "Serial range" : "Workorder no."}</span><strong>{displayRange}</strong></div>
          <div><span>Pages</span><strong>{state.pageCount || 1}</strong></div>
        </div>
        <div className="progress-track"><div className={`progress-fill ${isDone ? "complete" : isError ? "failed" : ""}`} /></div>
        {isDone && state.downloadUrl ? <a className="button primary download-link" href={state.downloadUrl} target="_blank" rel="noreferrer">Download PDF</a> : null}
        {isDone || isError ? <Button variant={isError ? "secondary" : "primary"} onClick={onClose}>Close</Button> : null}
      </div>
    </div>
  );
}

import { memo, useEffect, useState } from "react";
import { CheckCircle, ChevronLeft, ChevronRight, Printer, XClose, ZoomIn, ZoomOut } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { interfaceText } from "../../i18n/index.js";
import { normalizePreviewZoom, PREVIEW_ZOOM_MAX, PREVIEW_ZOOM_MIN } from "./preview-zoom.js";
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

export function PreviewFullscreen({ open, form, serials, pageIndex, zoom, range, countLabel, actionLabel, onClose, onPageChange, onZoomChange, onPrint, locale = "en" }) {
  if (!open) return null;
  const t = (key) => interfaceText(locale, key);
  const normalizedZoom = normalizePreviewZoom(zoom);
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
    <div className="preview-fullscreen" role="dialog" aria-modal="true" aria-label={t("preview.fullscreenWorkorder")}>
      <div className="preview-fullscreen-toolbar">
        <div className="fullscreen-title"><strong>{t("preview.title")}</strong><span>{countLabel} / {range}</span></div>
        <div className="fullscreen-toolbox" aria-label={t("preview.tools")}>
          <button className="icon-tooltip" type="button" onClick={() => onPageChange(safeIndex - 1)} disabled={!canGoBack} aria-label={t("preview.previousPage")} data-tooltip={t("preview.previousPage")}><ChevronLeft /></button>
          <span className="fullscreen-page-count">{safeIndex + 1} / {physicalPages.length}</span>
          <button className="icon-tooltip" type="button" onClick={() => onPageChange(safeIndex + 1)} disabled={!canGoForward} aria-label={t("preview.nextPage")} data-tooltip={t("preview.nextPage")}><ChevronRight /></button>
          <button className="icon-tooltip" type="button" onClick={() => onZoomChange(normalizedZoom - 1)} disabled={normalizedZoom <= PREVIEW_ZOOM_MIN} aria-label={t("location.zoomOut")} data-tooltip={t("location.zoomOut")}><ZoomOut /></button>
          <button className="icon-tooltip" type="button" onClick={() => onZoomChange(normalizedZoom + 1)} disabled={normalizedZoom >= PREVIEW_ZOOM_MAX} aria-label={t("location.zoomIn")} data-tooltip={t("location.zoomIn")}><ZoomIn /></button>
          {onPrint ? <button className="fullscreen-print icon-tooltip" type="button" onClick={onPrint} aria-label={actionLabel} data-tooltip={actionLabel}><Printer /></button> : null}
          <button className="icon-tooltip" type="button" onClick={onClose} aria-label={t("preview.closeFullscreen")} data-tooltip={t("preview.close")}><XClose /></button>
        </div>
      </div>
      <div className={`fullscreen-stage zoom-${normalizedZoom}`}>
        <div className="fullscreen-page-meta"><span>{t("preview.page")} {safeIndex + 1}</span><strong>{serial}</strong></div>
        <div className="fullscreen-page-wrap"><div className="workorder-preview-shell"><div dangerouslySetInnerHTML={{
          __html: renderWorkorderPageHtml(form, serial, physicalPage),
        }} /></div></div>
      </div>
    </div>
  );
}

export function PrintModal({ state, range, onClose, onCreateRevision = null, locale = "en" }) {
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionOpen, setRevisionOpen] = useState(false);
  useEffect(() => {
    setRevisionReason("");
    setRevisionOpen(false);
  }, [state.archive?.id, state.open]);
  if (!state.open) return null;
  const t = (key) => interfaceText(locale, key);
  const isDone = state.stage === "done";
  const isError = state.stage === "error";
  const displayRange = state.range || range;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="print-modal">
        <button className="close-button" type="button" onClick={onClose} aria-label={t("preview.closePrintStatus")}><XClose /></button>
        <div className={`modal-icon ${isDone ? "done" : isError ? "error" : ""}`}>{isDone ? <CheckCircle /> : <Printer />}</div>
        <h2>{isDone ? t("preview.printReady") : isError ? t("preview.printFailed") : t("preview.archiving")}</h2>
        <p>{state.message}</p>
        <div className="print-summary">
          <div><span>{displayRange.includes(" to ") ? t("preview.serialRange") : t("preview.workorderNumber")}</span><strong>{displayRange}</strong></div>
          <div><span>{t("preview.pages")}</span><strong>{state.pageCount || 1}</strong></div>
        </div>
        <div className="progress-track"><div className={`progress-fill ${isDone ? "complete" : isError ? "failed" : ""}`} /></div>
        {isDone && state.downloadUrl ? <a className="button primary download-link" href={state.downloadUrl} target="_blank" rel="noreferrer">{state.archive?.artifactKind === "revised" ? t("preview.downloadRevisedCopy") : t("preview.downloadArchivedOriginal")}</a> : null}
        {isDone && state.archive?.id && onCreateRevision ? <>
          {!revisionOpen ? <Button variant="secondary" onClick={() => setRevisionOpen(true)}>{t("preview.createRevisedCopy")}</Button> : <form className="print-revision-form" onSubmit={(event) => { event.preventDefault(); if (revisionReason.trim()) onCreateRevision(state.archive.id, revisionReason.trim()); }}>
            <label>{t("preview.revisionReason")}<textarea aria-describedby="print-revision-help" value={revisionReason} onChange={(event) => setRevisionReason(event.target.value)} required maxLength="1000" /></label>
            <p id="print-revision-help">{t("preview.revisionReasonHelp")} {state.archive.id}</p>
            <Button type="submit" variant="primary" disabled={!revisionReason.trim()}>{t("preview.createRevisedCopy")}</Button>
          </form>}
        </> : null}
        {isDone || isError ? <Button variant={isError ? "secondary" : "primary"} onClick={onClose}>{t("preview.close")}</Button> : null}
      </div>
    </div>
  );
}

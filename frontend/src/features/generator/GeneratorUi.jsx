import { CheckCircle, ChevronLeft, ChevronRight, Printer, XClose, ZoomIn, ZoomOut } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { renderWorkorderPageHtml } from "../../../../shared/workorder-template.js";

function longitudeToTile(longitude, zoom) {
  return Math.floor(((Number(longitude) + 180) / 360) * 2 ** zoom);
}

function latitudeToTile(latitude, zoom) {
  const radians = (Number(latitude) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * 2 ** zoom);
}

export function satelliteTiles(location, mapsConfig) {
  const zoom = 17;
  const centerX = longitudeToTile(location?.longitude, zoom);
  const centerY = latitudeToTile(location?.latitude, zoom);
  const hereKey = mapsConfig?.useHereSatelliteTiles ? mapsConfig?.hereBrowserApiKey : "";
  return [-1, 0, 1].flatMap((rowOffset) =>
    [-1, 0, 1].map((colOffset) => {
      const x = centerX + colOffset;
      const y = centerY + rowOffset;
      const src = hereKey
        ? `https://maps.hereapi.com/v3/base/mc/${zoom}/${x}/${y}/jpeg?style=satellite.day&size=256&apiKey=${encodeURIComponent(hereKey)}`
        : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`;
      return { key: `${x}-${y}`, src };
    }),
  );
}

export function SamsaraActionButton({ connected, loading, onConnect }) {
  if (loading || connected) {
    return (
      <span className={`samsara-connection-status ${connected ? "is-connected" : ""}`} role="status">
        {connected ? <CheckCircle /> : null}
        {connected ? "Samsara connected" : "Checking Samsara"}
      </span>
    );
  }
  return (
    <button
      className="samsara-action needs-connect"
      type="button"
      onClick={onConnect}
      aria-label="Connect Samsara"
      title="Connect Samsara"
    >
      <span>Connect</span>
      <img src="/samsara-logo.png" alt="" aria-hidden="true" />
    </button>
  );
}

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function WorkorderPreview({ serial, label, form }) {
  return (
    <div className="preview-page-card">
      <div className="preview-page-meta"><span>{label}</span><strong>{serial}</strong></div>
      <div className="workorder-preview-shell"><div dangerouslySetInnerHTML={{ __html: renderWorkorderPageHtml(form, serial) }} /></div>
    </div>
  );
}

export function PreviewFullscreen({ open, form, serials, pageIndex, zoom, range, countLabel, actionLabel, destinationLabel, onClose, onPageChange, onZoomChange, onPrint }) {
  if (!open) return null;
  const safeIndex = Math.min(Math.max(pageIndex, 0), serials.length - 1);
  const serial = serials[safeIndex] || "";
  const canGoBack = safeIndex > 0;
  const canGoForward = safeIndex < serials.length - 1;

  return (
    <div className="preview-fullscreen" role="dialog" aria-modal="true" aria-label="Fullscreen workorder preview">
      <div className="preview-fullscreen-toolbar">
        <div className="fullscreen-title"><strong>Preview</strong><span>{countLabel} / {range}</span></div>
        <div className="fullscreen-toolbox" aria-label="Preview tools">
          <button className="icon-tooltip" type="button" onClick={() => onPageChange(safeIndex - 1)} disabled={!canGoBack} aria-label="Previous page" data-tooltip="Previous page"><ChevronLeft /></button>
          <span className="fullscreen-page-count">{safeIndex + 1} / {serials.length}</span>
          <button className="icon-tooltip" type="button" onClick={() => onPageChange(safeIndex + 1)} disabled={!canGoForward} aria-label="Next page" data-tooltip="Next page"><ChevronRight /></button>
          <button className="icon-tooltip" type="button" onClick={() => onZoomChange(Math.max(0, zoom - 1))} disabled={zoom <= 0} aria-label="Zoom out" data-tooltip="Zoom out"><ZoomOut /></button>
          <button className="icon-tooltip" type="button" onClick={() => onZoomChange(Math.min(2, zoom + 1))} disabled={zoom >= 2} aria-label="Zoom in" data-tooltip="Zoom in"><ZoomIn /></button>
          {onPrint ? <button className="fullscreen-print icon-tooltip" type="button" onClick={onPrint} aria-label={actionLabel} data-tooltip={actionLabel}><Printer /></button> : null}
          <button className="icon-tooltip" type="button" onClick={onClose} aria-label="Close fullscreen preview" data-tooltip="Close"><XClose /></button>
        </div>
      </div>
      <div className={`fullscreen-stage zoom-${zoom}`}>
        <div className="fullscreen-page-meta"><span>Page {safeIndex + 1}</span><strong>{serial}</strong><small>{destinationLabel}</small></div>
        <div className="fullscreen-page-wrap"><div className="workorder-preview-shell"><div dangerouslySetInnerHTML={{ __html: renderWorkorderPageHtml(form, serial) }} /></div></div>
      </div>
    </div>
  );
}

export function PrintModal({ state, range, printerName, onClose }) {
  if (!state.open) return null;
  const isDone = state.stage === "done";
  const isError = state.stage === "error";
  const displayRange = state.range || range;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="print-modal">
        <button className="close-button" type="button" onClick={onClose} aria-label="Close print status"><XClose /></button>
        <div className={`modal-icon ${isDone ? "done" : isError ? "error" : ""}`}>{isDone ? <CheckCircle /> : <Printer />}</div>
        <h2>{isDone ? "Print job ready" : isError ? "Print failed" : "Preparing print job"}</h2>
        <p>{state.message}</p>
        <div className="print-summary">
          <div><span>{displayRange.includes(" to ") ? "Serial range" : "Workorder no."}</span><strong>{displayRange}</strong></div>
          <div><span>Destination</span><strong>{printerName || "Save PDF only"}</strong></div>
        </div>
        <div className="progress-track"><div className={`progress-fill ${isDone ? "complete" : isError ? "failed" : ""}`} /></div>
        {isDone && state.downloadUrl ? <a className="button primary download-link" href={state.downloadUrl} target="_blank" rel="noreferrer">Download PDF</a> : null}
        {isDone || isError ? <Button variant={isError ? "secondary" : "primary"} onClick={onClose}>Close</Button> : null}
      </div>
    </div>
  );
}

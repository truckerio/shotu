import { useEffect, useRef, useState } from "react";
import { Download01, Expand01, FileSearch01, LinkExternal01, RefreshCw01, Scale01, ZoomIn, ZoomOut } from "@untitledui/icons";
import {
  changeDocumentZoom,
  DOCUMENT_ZOOM_MAX,
  DOCUMENT_ZOOM_MIN,
  documentRotationTransform,
  documentZoomLabel,
  nextDocumentRotation,
} from "./invoice-document-viewer-model.js";

export function InvoiceDocumentViewer({ sourceUrl = "", mimeType = "", fileName = "Invoice source" }) {
  const viewerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const isPdf = mimeType === "application/pdf" || /\.pdf$/i.test(fileName);
  const hasSource = Boolean(sourceUrl);
  const fullscreenAvailable = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);

  useEffect(() => {
    setZoom(1);
    setRotation(0);
  }, [sourceUrl]);

  useEffect(() => {
    function handleFullscreenChange() {
      setFullscreen(document.fullscreenElement === viewerRef.current);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (!hasSource || !fullscreenAvailable) return;
    if (document.fullscreenElement === viewerRef.current) await document.exitFullscreen();
    else await viewerRef.current?.requestFullscreen();
  }

  function resetView() {
    setZoom(1);
    setRotation(0);
  }

  return (
    <aside className="invoice-document-viewer" aria-label="Original invoice document" ref={viewerRef}>
      <header className="invoice-document-header">
        <div className="invoice-document-title"><strong>Original invoice</strong><span>{hasSource ? fileName : "Source unavailable"}</span></div>
        <div className="invoice-document-toolbar" role="toolbar" aria-label="Document viewer tools">
          <button type="button" onClick={() => setZoom((current) => changeDocumentZoom(current, "out"))} disabled={!hasSource || zoom <= DOCUMENT_ZOOM_MIN} aria-label="Zoom out" title="Zoom out"><ZoomOut /></button>
          <output aria-label="Document zoom">{documentZoomLabel(zoom)}</output>
          <button type="button" onClick={() => setZoom((current) => changeDocumentZoom(current, "in"))} disabled={!hasSource || zoom >= DOCUMENT_ZOOM_MAX} aria-label="Zoom in" title="Zoom in"><ZoomIn /></button>
          <button type="button" onClick={resetView} disabled={!hasSource || (zoom === 1 && rotation === 0)} aria-label="Reset document view" title="Reset view"><Scale01 /></button>
          <button type="button" onClick={() => setRotation((current) => nextDocumentRotation(current))} disabled={!hasSource || isPdf} aria-label="Rotate image clockwise" title={isPdf ? "Use the PDF viewer to rotate pages" : "Rotate clockwise"}><RefreshCw01 /></button>
          <button type="button" onClick={toggleFullscreen} disabled={!hasSource || !fullscreenAvailable} aria-label={fullscreen ? "Exit fullscreen document view" : "Open fullscreen document view"} title={fullscreen ? "Exit fullscreen" : "Fullscreen"}><Expand01 /></button>
          {hasSource ? <a href={sourceUrl} target="_blank" rel="noreferrer" aria-label="Open original invoice in a new tab" title="Open original"><LinkExternal01 /></a> : null}
          {hasSource ? <a href={sourceUrl} download={fileName} aria-label="Download original invoice" title="Download original"><Download01 /></a> : null}
        </div>
      </header>
      <div className="invoice-document-stage">
        {hasSource ? (
          <div className="invoice-document-content" style={{ width: `${zoom * 100}%`, transform: documentRotationTransform(rotation) }}>
            {isPdf
              ? <object data={sourceUrl} type="application/pdf" title={`Original invoice: ${fileName}`}><a href={sourceUrl} target="_blank" rel="noreferrer">Open the uploaded PDF</a></object>
              : <img src={sourceUrl} alt={`Original invoice: ${fileName}`} />}
          </div>
        ) : (
          <div className="invoice-document-empty" role="status"><FileSearch01 aria-hidden="true" /><strong>Document source unavailable</strong><span>The reviewed values remain available, but the original file can no longer be displayed.</span></div>
        )}
      </div>
    </aside>
  );
}

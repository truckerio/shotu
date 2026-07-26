import { Children, useEffect, useRef, useState } from "react";

const DETAIL_LAYOUT = Object.freeze({
  defaultPreviewPercent: 40,
  minControlWidth: 440,
  minPreviewWidth: 680,
  storageKey: "workorder.detailPreviewPercent.v2",
});
const CREATE_LAYOUT = Object.freeze({
  defaultPreviewPercent: 62,
  minControlWidth: 390,
  minPreviewWidth: 560,
  storageKey: "workorder.createPreviewPercent.v1",
});
const RESIZER_WIDTH = 8;

function initialPreviewPercent(layout) {
  if (typeof window === "undefined") return layout.defaultPreviewPercent;
  const saved = Number(window.localStorage.getItem(layout.storageKey));
  return Number.isFinite(saved) && saved > 0 ? saved : layout.defaultPreviewPercent;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function WorkorderDetailLayout({ detail, previewOpen, children }) {
  const shellRef = useRef(null);
  const layout = detail ? DETAIL_LAYOUT : CREATE_LAYOUT;
  const [previewPercent, setPreviewPercent] = useState(() => initialPreviewPercent(layout));
  const [resizing, setResizing] = useState(false);
  const panes = Children.toArray(children);

  function bounds() {
    const width = shellRef.current?.getBoundingClientRect().width || 0;
    if (!width) return { minimum: layout.defaultPreviewPercent, maximum: layout.defaultPreviewPercent };

    const minimum = (layout.minPreviewWidth / width) * 100;
    const maximum = ((width - layout.minControlWidth - RESIZER_WIDTH) / width) * 100;
    if (minimum > maximum) return { minimum: layout.defaultPreviewPercent, maximum: layout.defaultPreviewPercent };
    return { minimum, maximum };
  }

  function resizeFromPointer(clientX) {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    const limits = bounds();
    const next = ((rect.right - clientX) / rect.width) * 100;
    setPreviewPercent(clamp(next, limits.minimum, limits.maximum));
  }

  function startResize(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    setResizing(true);
    resizeFromPointer(event.clientX);
  }

  function resizeWithKeyboard(event) {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    const limits = bounds();
    if (event.key === "Home") {
      setPreviewPercent(clamp(layout.defaultPreviewPercent, limits.minimum, limits.maximum));
      return;
    }
    const change = event.key === "ArrowLeft" ? 3 : -3;
    setPreviewPercent((current) => clamp(current + change, limits.minimum, limits.maximum));
  }

  useEffect(() => {
    if (!resizing) return undefined;
    const handleMove = (event) => resizeFromPointer(event.clientX);
    const handleEnd = () => setResizing(false);
    document.body.classList.add("is-resizing-workorder");
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd);
    window.addEventListener("pointercancel", handleEnd);
    return () => {
      document.body.classList.remove("is-resizing-workorder");
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
      window.removeEventListener("pointercancel", handleEnd);
    };
  }, [resizing]);

  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(layout.storageKey, String(previewPercent));
  }, [layout.storageKey, previewPercent]);

  useEffect(() => {
    setPreviewPercent(initialPreviewPercent(layout));
  }, [layout.storageKey]);

  useEffect(() => {
    const fitSavedWidth = () => {
      const limits = bounds();
      setPreviewPercent((current) => clamp(current, limits.minimum, limits.maximum));
    };
    fitSavedWidth();
    window.addEventListener("resize", fitSavedWidth);
    return () => window.removeEventListener("resize", fitSavedWidth);
  }, []);

  const limits = bounds();
  const effectivePercent = previewOpen ? clamp(previewPercent, limits.minimum, limits.maximum) : 0;
  const layoutClass = detail ? "workorder-detail-layout" : "generator-layout";
  const separatorLabel = detail ? "Resize workorder and preview panels" : "Resize form and preview panels";
  return (
    <section
      ref={shellRef}
      className={`split-layout ${layoutClass} ${previewOpen ? "has-preview" : ""} ${resizing ? "is-resizing" : ""}`}
      style={{
        "--preview-pane-width": `${effectivePercent}%`,
        "--detail-resizer-width": previewOpen ? `${RESIZER_WIDTH}px` : "0px",
      }}
    >
      {panes[0]}
      {previewOpen ? (
        <div
          className="detail-pane-resizer"
          role="separator"
          aria-label={separatorLabel}
          aria-orientation="vertical"
          aria-valuemin={Math.round(limits.minimum)}
          aria-valuemax={Math.round(limits.maximum)}
          aria-valuenow={Math.round(previewPercent)}
          tabIndex={0}
          title="Drag to resize panels"
          onPointerDown={startResize}
          onKeyDown={resizeWithKeyboard}
          onDoubleClick={() => {
            const currentBounds = bounds();
            setPreviewPercent(clamp(layout.defaultPreviewPercent, currentBounds.minimum, currentBounds.maximum));
          }}
        >
          <span />
        </div>
      ) : null}
      {panes.slice(1)}
    </section>
  );
}

import { Children, useEffect, useRef, useState } from "react";

const DEFAULT_PREVIEW_PERCENT = 40;
const MIN_CONTROL_WIDTH = 440;
const MIN_PREVIEW_WIDTH = 680;
const RESIZER_WIDTH = 8;
const STORAGE_KEY = "workorder.detailPreviewPercent.v2";

function initialPreviewPercent() {
  if (typeof window === "undefined") return DEFAULT_PREVIEW_PERCENT;
  const saved = Number(window.localStorage.getItem(STORAGE_KEY));
  return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_PREVIEW_PERCENT;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function WorkorderDetailLayout({ detail, previewOpen, children }) {
  const shellRef = useRef(null);
  const [previewPercent, setPreviewPercent] = useState(initialPreviewPercent);
  const [resizing, setResizing] = useState(false);
  const panes = Children.toArray(children);

  function bounds() {
    const width = shellRef.current?.getBoundingClientRect().width || 0;
    if (!width) return { minimum: DEFAULT_PREVIEW_PERCENT, maximum: 58 };

    const minimum = (MIN_PREVIEW_WIDTH / width) * 100;
    const maximum = ((width - MIN_CONTROL_WIDTH - RESIZER_WIDTH) / width) * 100;
    if (minimum > maximum) return { minimum: DEFAULT_PREVIEW_PERCENT, maximum: DEFAULT_PREVIEW_PERCENT };
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
      setPreviewPercent(clamp(DEFAULT_PREVIEW_PERCENT, limits.minimum, limits.maximum));
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
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, String(previewPercent));
  }, [previewPercent]);

  useEffect(() => {
    const fitSavedWidth = () => {
      const limits = bounds();
      setPreviewPercent((current) => clamp(current, limits.minimum, limits.maximum));
    };
    fitSavedWidth();
    window.addEventListener("resize", fitSavedWidth);
    return () => window.removeEventListener("resize", fitSavedWidth);
  }, []);

  if (!detail) {
    return (
      <section className={`split-layout generator-layout ${previewOpen ? "has-preview" : ""}`}>
        {panes}
      </section>
    );
  }

  const limits = bounds();
  const effectivePercent = previewOpen ? clamp(previewPercent, limits.minimum, limits.maximum) : 0;
  return (
    <section
      ref={shellRef}
      className={`split-layout workorder-detail-layout ${previewOpen ? "has-preview" : ""} ${resizing ? "is-resizing" : ""}`}
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
          aria-label="Resize workorder and preview panels"
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
            setPreviewPercent(clamp(DEFAULT_PREVIEW_PERCENT, currentBounds.minimum, currentBounds.maximum));
          }}
        >
          <span />
        </div>
      ) : null}
      {panes.slice(1)}
    </section>
  );
}

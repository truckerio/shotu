import { Children, useEffect, useRef, useState } from "react";
import "./workorder-detail-layout.css";

const DETAIL_LAYOUT = Object.freeze({
  defaultPreviewPercent: 40,
  // Keep the detail editor usable when users drag the split. Below this
  // width assignment controls and summary facts become clipped.
  minControlWidth: 560,
  minPreviewWidth: 680,
  storageKey: "workorder.detailPreviewPercent.v2",
});
const CREATE_LAYOUT = Object.freeze({
  defaultPreviewPercent: 50,
  minControlWidth: 620,
  minPreviewWidth: 560,
  responsiveToLandscape: true,
  storageKey: "workorder.createPreviewPercent.v3",
});
const RESIZER_WIDTH = 8;
const WORKORDER_ASPECT_RATIO = 11 / 8.5;

function defaultPreviewPercent(layout, width = 0) {
  if (!layout.responsiveToLandscape || typeof window === "undefined" || !width) {
    return layout.defaultPreviewPercent;
  }
  const paperFitWidth = Math.max(
    layout.minPreviewWidth,
    (window.innerHeight - 180) * WORKORDER_ASPECT_RATIO + 28,
  );
  const preferredWidth = Math.min(width * 0.5, paperFitWidth);
  const minimum = (layout.minPreviewWidth / width) * 100;
  const maximum = ((width - layout.minControlWidth - RESIZER_WIDTH) / width) * 100;
  if (minimum > maximum) return layout.defaultPreviewPercent;
  return clamp((preferredWidth / width) * 100, minimum, maximum);
}

function savedPreviewPercent(layout) {
  if (typeof window === "undefined") return null;
  const saved = Number(window.localStorage.getItem(layout.storageKey));
  return Number.isFinite(saved) && saved > 0 ? saved : null;
}

function initialPreviewPercent(layout) {
  const saved = savedPreviewPercent(layout);
  if (saved) return saved;
  const width = typeof window === "undefined" ? 0 : window.innerWidth - 48;
  return defaultPreviewPercent(layout, width);
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function WorkorderDetailLayout({ detail, previewOpen, children }) {
  const shellRef = useRef(null);
  const layout = detail ? DETAIL_LAYOUT : CREATE_LAYOUT;
  const [previewPercent, setPreviewPercent] = useState(() => initialPreviewPercent(layout));
  const [resizing, setResizing] = useState(false);
  const userSizedRef = useRef(Boolean(savedPreviewPercent(layout)));
  const panes = Children.toArray(children);

  function setUserPreviewPercent(nextValue) {
    userSizedRef.current = true;
    setPreviewPercent((current) => {
      const next = typeof nextValue === "function" ? nextValue(current) : nextValue;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(layout.storageKey, String(next));
      }
      return next;
    });
  }

  function bounds() {
    const width = shellRef.current?.getBoundingClientRect().width || 0;
    const fallback = defaultPreviewPercent(layout, width);
    if (!width) return { minimum: fallback, maximum: fallback };

    const minimum = (layout.minPreviewWidth / width) * 100;
    const maximum = ((width - layout.minControlWidth - RESIZER_WIDTH) / width) * 100;
    if (minimum > maximum) return { minimum: fallback, maximum: fallback };
    return { minimum, maximum };
  }

  function resizeFromPointer(clientX) {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    const limits = bounds();
    const next = ((rect.right - clientX) / rect.width) * 100;
    setUserPreviewPercent(clamp(next, limits.minimum, limits.maximum));
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
      userSizedRef.current = false;
      window.localStorage.removeItem(layout.storageKey);
      const width = shellRef.current?.getBoundingClientRect().width || 0;
      setPreviewPercent(clamp(defaultPreviewPercent(layout, width), limits.minimum, limits.maximum));
      return;
    }
    const change = event.key === "ArrowLeft" ? 3 : -3;
    setUserPreviewPercent((current) => clamp(current + change, limits.minimum, limits.maximum));
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
    const saved = savedPreviewPercent(layout);
    userSizedRef.current = Boolean(saved);
    setPreviewPercent(saved || initialPreviewPercent(layout));
  }, [layout.storageKey]);

  useEffect(() => {
    const fitSavedWidth = () => {
      const limits = bounds();
      const width = shellRef.current?.getBoundingClientRect().width || 0;
      setPreviewPercent((current) => {
        const next = userSizedRef.current
          ? clamp(current, limits.minimum, limits.maximum)
          : clamp(defaultPreviewPercent(layout, width), limits.minimum, limits.maximum);
        if (userSizedRef.current && typeof window !== "undefined") {
          window.localStorage.setItem(layout.storageKey, String(next));
        }
        return next;
      });
    };
    fitSavedWidth();
    window.addEventListener("resize", fitSavedWidth);
    return () => window.removeEventListener("resize", fitSavedWidth);
  }, [layout]);

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
            const width = shellRef.current?.getBoundingClientRect().width || 0;
            userSizedRef.current = false;
            window.localStorage.removeItem(layout.storageKey);
            setPreviewPercent(clamp(
              defaultPreviewPercent(layout, width),
              currentBounds.minimum,
              currentBounds.maximum,
            ));
          }}
        >
          <span />
        </div>
      ) : null}
      {panes.slice(1)}
    </section>
  );
}

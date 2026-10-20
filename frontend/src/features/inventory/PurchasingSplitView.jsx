import { useEffect, useRef, useState } from "react";

const MIN_RATIO = 30;
const MAX_RATIO = 70;
const DEFAULT_RATIO = 50;

function clampRatio(value) {
  if (value === null || value === "") return DEFAULT_RATIO;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, Number(value) || DEFAULT_RATIO));
}

export function PurchasingSplitView({ actorId = "", left, right }) {
  const storageKey = `inventory-purchasing-split:${actorId || "shared"}`;
  const [ratio, setRatio] = useState(() => {
    try { return clampRatio(localStorage.getItem(storageKey)); } catch { return DEFAULT_RATIO; }
  });
  const containerRef = useRef(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(ratio)); } catch { /* The layout remains usable without persistence. */ }
  }, [ratio, storageKey]);

  function ratioFromPointer(clientX) {
    const bounds = containerRef.current?.getBoundingClientRect();
    if (!bounds?.width) return ratio;
    return clampRatio(((clientX - bounds.left) / bounds.width) * 100);
  }

  function onPointerDown(event) {
    if (event.button !== 0) return;
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    setRatio(ratioFromPointer(event.clientX));
  }

  function onPointerMove(event) {
    if (draggingRef.current) setRatio(ratioFromPointer(event.clientX));
  }

  function stopDragging(event) {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function onKeyDown(event) {
    const next = {
      ArrowLeft: ratio - 2,
      ArrowRight: ratio + 2,
      Home: MIN_RATIO,
      End: MAX_RATIO,
      Enter: DEFAULT_RATIO,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setRatio(clampRatio(next));
  }

  return <section ref={containerRef} className="purchasing-split-view" style={{ "--purchasing-left-ratio": `${ratio}%` }}>
    <section className="purchasing-split-pane is-orders" aria-label="Purchase orders">{left}</section>
    <div
      className="purchasing-split-divider"
      role="separator"
      aria-label="Resize purchasing panes"
      aria-orientation="vertical"
      aria-valuemin={MIN_RATIO}
      aria-valuemax={MAX_RATIO}
      aria-valuenow={Math.round(ratio)}
      tabIndex={0}
      onDoubleClick={() => setRatio(DEFAULT_RATIO)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
    ><span aria-hidden="true" /></div>
    <section className="purchasing-split-pane is-inbound" aria-label="Deliveries and invoices">{right}</section>
  </section>;
}

import { useEffect, useId, useRef, useState } from "react";
import "./draggable-bottom-sheet.css";

const SNAP_PEEK = "peek";
const SNAP_EXPANDED = "expanded";
const DRAG_THRESHOLD = 32;
const VELOCITY_THRESHOLD = 0.42;

/**
 * Determines the resting snap without coupling the interaction to a renderer.
 * A positive delta/velocity means the pointer travelled down toward the peek.
 */
export function getBottomSheetSnap({ startSnap, deltaY = 0, velocityY = 0, threshold = DRAG_THRESHOLD }) {
  if (velocityY >= VELOCITY_THRESHOLD) return SNAP_PEEK;
  if (velocityY <= -VELOCITY_THRESHOLD) return SNAP_EXPANDED;
  if (Math.abs(deltaY) < threshold) return startSnap;
  return deltaY > 0 ? SNAP_PEEK : SNAP_EXPANDED;
}

export function hasTransformTransition({ transitionProperty = "", transitionDuration = "" }) {
  const properties = transitionProperty.split(",").map((value) => value.trim());
  const durations = transitionDuration.split(",").map((value) => value.trim());
  return properties.some((property, index) => {
    const duration = durations[index % Math.max(1, durations.length)] || "0s";
    return (property === "transform" || property === "all") && Number.parseFloat(duration) > 0;
  });
}

export function DraggableBottomSheet({
  open,
  snap = SNAP_EXPANDED,
  onSnapChange,
  onSnapSettled,
  peekHeight = 112,
  disabled = false,
  title,
  titleId,
  minimizeLabel = "Minimize details",
  expandLabel = "Expand details",
  children,
  footer = null,
  className = "",
}) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId || generatedTitleId;
  const sheetRef = useRef(null);
  const handleRef = useRef(null);
  const contentRef = useRef(null);
  const footerRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const onSnapSettledRef = useRef(onSnapSettled);
  const pendingSettlementRef = useRef(null);
  const settlementFrameRef = useRef(null);
  const settlementTokenRef = useRef(0);
  const previousSnapRef = useRef(null);
  const [dragOffset, setDragOffset] = useState(null);

  const clearPendingSettlement = () => {
    pendingSettlementRef.current = null;
    if (settlementFrameRef.current !== null) {
      cancelAnimationFrame(settlementFrameRef.current);
      settlementFrameRef.current = null;
    }
  };

  const settleSnap = (token, settledSnap) => {
    if (settlementTokenRef.current !== token || pendingSettlementRef.current?.token !== token) return;
    pendingSettlementRef.current = null;
    onSnapSettledRef.current?.(settledSnap);
  };

  useEffect(() => {
    onSnapSettledRef.current = onSnapSettled;
  }, [onSnapSettled]);

  useEffect(() => {
    if (!open) {
      dragRef.current = null;
      setDragOffset(null);
    }
  }, [open]);

  useEffect(() => {
    if (snap !== SNAP_PEEK || typeof document === "undefined") return;
    const activeElement = document.activeElement;
    if (contentRef.current?.contains(activeElement) || footerRef.current?.contains(activeElement)) {
      handleRef.current?.focus();
    }
  }, [snap]);

  useEffect(() => {
    if (!disabled || !dragRef.current) return;
    dragRef.current = null;
    setDragOffset(null);
  }, [disabled]);

  useEffect(() => {
    clearPendingSettlement();
    const token = ++settlementTokenRef.current;
    const snapChanged = previousSnapRef.current !== null && previousSnapRef.current !== snap;
    previousSnapRef.current = snap;
    if (!open) return undefined;
    if (dragOffset !== null) return undefined;

    settlementFrameRef.current = requestAnimationFrame(() => {
      settlementFrameRef.current = null;
      const sheet = sheetRef.current;
      if (settlementTokenRef.current !== token || !sheet || dragRef.current) return;
      const style = getComputedStyle(sheet);
      if (!snapChanged || !hasTransformTransition(style)) {
        pendingSettlementRef.current = { token, snap };
        settleSnap(token, snap);
        return;
      }
      pendingSettlementRef.current = { token, snap };
    });
    return () => clearPendingSettlement();
  }, [dragOffset, open, snap]);

  if (!open) return null;

  const requestSnap = (nextSnap) => {
    if (disabled) return;
    setDragOffset(null);
    if (nextSnap !== snap) onSnapChange?.(nextSnap);
  };

  const getPeekOffset = () => {
    const rect = sheetRef.current?.getBoundingClientRect();
    // At the peek snap CSS includes env(safe-area-inset-bottom). Reading the
    // rendered fixed offset keeps a new pointer drag continuous on iPhones.
    if (snap === SNAP_PEEK && rect) {
      return Math.max(0, rect.bottom - window.innerHeight);
    }
    const height = rect?.height || 0;
    return Math.max(0, height - peekHeight);
  };

  const onPointerDown = (event) => {
    if (disabled || event.button !== 0) return;
    clearPendingSettlement();
    settlementTokenRef.current += 1;
    const handle = event.currentTarget;
    const peekOffset = getPeekOffset();
    const startOffset = snap === SNAP_PEEK ? peekOffset : 0;
    dragRef.current = {
      pointerId: event.pointerId,
      peekOffset,
      startedAt: event.timeStamp,
      startOffset,
      startSnap: snap,
      startY: event.clientY,
      lastY: event.clientY,
      lastAt: event.timeStamp,
    };
    suppressClickRef.current = false;
    handle.setPointerCapture?.(event.pointerId);
    setDragOffset(startOffset);
  };

  const onPointerMove = (event) => {
    if (disabled) return;
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaY = event.clientY - drag.startY;
    const nextOffset = Math.min(drag.peekOffset, Math.max(0, drag.startOffset + deltaY));
    if (Math.abs(deltaY) > 4) suppressClickRef.current = true;
    drag.lastY = event.clientY;
    drag.lastAt = event.timeStamp;
    setDragOffset(nextOffset);
  };

  const finishDrag = (event, cancelled = false) => {
    if (disabled) {
      dragRef.current = null;
      setDragOffset(null);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    const deltaY = drag.lastY - drag.startY;
    const elapsed = Math.max(1, drag.lastAt - drag.startedAt);
    const velocityY = deltaY / elapsed;
    setDragOffset(null);
    if (cancelled) {
      requestSnap(drag.startSnap);
      return;
    }
    requestSnap(getBottomSheetSnap({ startSnap: drag.startSnap, deltaY, velocityY }));
  };

  const onHandleKeyDown = (event) => {
    if (disabled) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      requestSnap(SNAP_EXPANDED);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      requestSnap(SNAP_PEEK);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      requestSnap(snap === SNAP_EXPANDED ? SNAP_PEEK : SNAP_EXPANDED);
    }
  };

  const onTransitionEnd = (event) => {
    const pending = pendingSettlementRef.current;
    if (event.target !== sheetRef.current || event.propertyName !== "transform" || !pending || dragRef.current) return;
    settleSnap(pending.token, pending.snap);
  };

  const style = {
    "--bottom-sheet-peek-height": `${peekHeight}px`,
    ...(dragOffset === null ? {} : { "--bottom-sheet-drag-offset": `${dragOffset}px` }),
  };

  return (
    <section
      ref={sheetRef}
      className={`draggable-bottom-sheet is-${snap} ${dragOffset === null ? "" : "is-dragging"} ${className}`.trim()}
      role="dialog"
      aria-modal="false"
      aria-labelledby={resolvedTitleId}
      onTransitionEnd={onTransitionEnd}
      style={style}
    >
      <button
        ref={handleRef}
        className="draggable-bottom-sheet-handle"
        type="button"
        disabled={disabled}
        aria-label={snap === SNAP_EXPANDED ? minimizeLabel : expandLabel}
        aria-expanded={snap === SNAP_EXPANDED}
        onClick={() => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          requestSnap(snap === SNAP_EXPANDED ? SNAP_PEEK : SNAP_EXPANDED);
        }}
        onKeyDown={onHandleKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={(event) => finishDrag(event, true)}
      >
        <span aria-hidden="true" />
      </button>
      <div className="draggable-bottom-sheet-header">
        <h2 id={resolvedTitleId}>{title}</h2>
      </div>
      <div ref={contentRef} className="draggable-bottom-sheet-content" inert={snap === SNAP_PEEK ? "" : undefined}>{children}</div>
      {footer ? <footer ref={footerRef} className="draggable-bottom-sheet-footer" inert={snap === SNAP_PEEK ? "" : undefined}>{footer}</footer> : null}
    </section>
  );
}

export { SNAP_EXPANDED, SNAP_PEEK };

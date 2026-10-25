import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dropdown } from "../forms/Dropdown.jsx";
import {
  checkpointAriaLabel,
  checkpointRecordRange,
  clampCheckpointPage,
  nextCheckpointPage,
  normalizePageCount,
  selectCheckpointPages,
} from "./checkpoint-rail-model.js";
import "./checkpoint-rail.css";

const MAX_DROPDOWN_BATCHES = 1000;

function previewLines(preview) {
  if (Array.isArray(preview)) return preview.filter((line) => typeof line === "string" && line.trim());
  if (typeof preview === "string" && preview.trim()) return [preview];
  return [];
}

export function CheckpointRail({
  pageCount,
  currentPage,
  total,
  pageSize = 20,
  onJump,
  getPreview,
  disabled = false,
  label = "Records",
}) {
  const railId = useId().replaceAll(":", "");
  const railRef = useRef(null);
  const tickRefs = useRef(new Map());
  const [railHeight, setRailHeight] = useState(0);
  const [hoveredPage, setHoveredPage] = useState(null);
  const [focusedPage, setFocusedPage] = useState(null);
  const [previewPosition, setPreviewPosition] = useState({ left: 34, top: 98 });
  const count = normalizePageCount(pageCount, total, pageSize);
  const selectedPage = clampCheckpointPage(currentPage, count);
  const pages = useMemo(
    () => selectCheckpointPages(count, selectedPage, railHeight),
    [count, railHeight, selectedPage],
  );
  const [rovingPage, setRovingPage] = useState(selectedPage);
  const [exactPage, setExactPage] = useState(String(selectedPage || 1));
  const previewPage = hoveredPage ?? focusedPage;
  const knownRecords = previewPage ? previewLines(getPreview?.(previewPage)) : [];

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return undefined;
    const measure = () => setRailHeight(rail.getBoundingClientRect().height);
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    return () => observer.disconnect();
  }, [count > 0]);

  useEffect(() => {
    if (pages.includes(selectedPage)) setRovingPage(selectedPage);
    setExactPage(String(selectedPage || 1));
  }, [pages, selectedPage]);

  function jump(page) {
    if (!disabled && page >= 1 && page <= count) onJump?.(page);
  }

  function positionPreview(node) {
    const bounds = node.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const edgeInset = Math.min(98, viewportHeight / 2);
    setPreviewPosition({
      left: Math.max(8, Math.min(bounds.right + 6, viewportWidth - 268)),
      top: Math.max(edgeInset, Math.min(bounds.top + (bounds.height / 2), viewportHeight - edgeInset)),
    });
  }

  function handleTickKeyDown(event, page) {
    if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const nextPage = nextCheckpointPage(pages, page, event.key);
      setRovingPage(nextPage);
      tickRefs.current.get(nextPage)?.focus();
      return;
    }
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      jump(page);
    }
  }

  function submitExactPage(event) {
    event.preventDefault();
    jump(clampCheckpointPage(exactPage, count));
  }

  if (!count) {
    return <div className="checkpoint-rail checkpoint-rail-empty" aria-label={`No ${label.toLowerCase()} batches`} />;
  }

  return (
    <div className="checkpoint-rail" style={{ "--checkpoint-batch-count": count }}>
      <nav className="checkpoint-rail-track" aria-label={`${label} batches`} ref={railRef}>
        {pages.map((page) => {
          const active = page === selectedPage;
          const showingPreview = page === previewPage;
          const range = checkpointRecordRange(page, total, pageSize);
          const tooltipId = `${railId}-preview-${page}`;
          return (
            <button
              aria-current={active ? "page" : undefined}
              aria-describedby={showingPreview ? tooltipId : undefined}
              aria-label={`${label}: ${checkpointAriaLabel(page, count, total, pageSize)}`}
              className="checkpoint-rail-tick"
              disabled={disabled}
              key={page}
              onBlur={() => setFocusedPage(null)}
              onClick={() => jump(page)}
              onFocus={(event) => {
                positionPreview(event.currentTarget);
                setFocusedPage(page);
              }}
              onKeyDown={(event) => handleTickKeyDown(event, page)}
              onPointerEnter={(event) => {
                positionPreview(event.currentTarget);
                setHoveredPage(page);
              }}
              onPointerLeave={() => setHoveredPage(null)}
              ref={(node) => {
                if (node) tickRefs.current.set(page, node);
                else tickRefs.current.delete(page);
              }}
              tabIndex={page === rovingPage ? 0 : -1}
              type="button"
            >
              <span className="checkpoint-rail-mark" aria-hidden="true" />
              {showingPreview ? (
                <span
                  className="checkpoint-rail-preview"
                  id={tooltipId}
                  role="tooltip"
                  style={{ left: previewPosition.left, top: previewPosition.top }}
                >
                  <strong>Batch {page} of {count}</strong>
                  <span className="checkpoint-rail-preview-range">
                    {range.start ? `Records ${range.start}–${range.end} of ${total}` : "No records"}
                  </span>
                  {knownRecords.length ? (
                    <span className="checkpoint-rail-preview-records">
                      {knownRecords.map((record, index) => <span key={`${record}-${index}`}>{record}</span>)}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="checkpoint-rail-compact">
        {count <= MAX_DROPDOWN_BATCHES ? (
          <Dropdown
            aria-label={`${label}: Choose batch, current batch ${selectedPage} of ${count}`}
            className="checkpoint-rail-dropdown"
            disabled={disabled}
            onChange={(event) => jump(Number(event.currentTarget.value))}
            placement="bottom start"
            popoverClassName="checkpoint-rail-dropdown-popover"
            value={String(selectedPage)}
          >
            {Array.from({ length: count }, (_, index) => {
              const page = index + 1;
              const range = checkpointRecordRange(page, total, pageSize);
              return <option key={page} value={page}>Batch {page} / {count} · {range.start}–{range.end}</option>;
            })}
          </Dropdown>
        ) : (
          <details className="checkpoint-rail-exact-jump" onToggle={(event) => disabled && (event.currentTarget.open = false)}>
            <summary
              aria-label={`${label}: Choose batch, current batch ${selectedPage} of ${count}`}
              aria-disabled={disabled || undefined}
              onClick={(event) => disabled && event.preventDefault()}
              onKeyDown={(event) => disabled && event.preventDefault()}
            >
              Batch {selectedPage} / {count}
            </summary>
            <form onSubmit={submitExactPage}>
              <label htmlFor={`${railId}-exact-page`}>Go to batch</label>
              <div>
                <input
                  disabled={disabled}
                  id={`${railId}-exact-page`}
                  inputMode="numeric"
                  max={count}
                  min="1"
                  onChange={(event) => setExactPage(event.currentTarget.value)}
                  required
                  type="number"
                  value={exactPage}
                />
                <button disabled={disabled} type="submit">Go</button>
              </div>
            </form>
          </details>
        )}
      </div>
    </div>
  );
}

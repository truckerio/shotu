import { cloneElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { OperationalCollectionTable } from "../operations/OperationalCollectionPage.jsx";
import { CheckpointRail } from "./CheckpointRail.jsx";
import { OperationalDataTable } from "./OperationalDataTable.jsx";
import { readCheckpointPosition, saveCheckpointPosition } from "../operations/checkpoint-position.js";
import "../operations/checkpoint-queue-table.css";
import "./checkpoint-collection.css";

const defaultItemKey = (item) => item.id;
import { createCheckpointScrollWork, firstVisibleCheckpointRow, checkpointPrefetchDistance } from "../operations/checkpoint-scroll-work.js";
import { createCheckpointExtent } from "../operations/checkpoint-extent.js";

// Keep DOM rows bounded while preserving an actual row, not estimated row heights.
export function CheckpointCollection({ queue, columns, renderItem, renderItems, header, ariaLabel, className = "", storageKey, children, label = "records", pageSize = 20, getItemKey = defaultItemKey, getPreview, statusPlacement = "overlay" }) {
  const tableRef = useRef(null);
  const anchor = useRef(null);
  const restoring = useRef(true);
  const lastScroll = useRef(0);
  const revision = useRef(queue.jumpRevision);
  const [currentPage, setCurrentPage] = useState(() => readCheckpointPosition(storageKey)?.page || 1);
  const previousKey = useRef(storageKey);
  const callbacks = useRef(queue);
  callbacks.current = queue;
  const rowNodes = useRef([]);
  const batchNodes = useRef([]);
  const processRef = useRef(null);
  const extent = useMemo(() => createCheckpointExtent(pageSize), [storageKey, pageSize]);
  const [spacing, setSpacing] = useState({ before: 0, after: 0 });
  const skippedScroll = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [viewportHeight, setViewportHeight] = useState(null);
  const [rowRevision, setRowRevision] = useState(0);
  const work = useMemo(() => createCheckpointScrollWork({
    onFrame: (hint) => processRef.current(hint),
    onPersist: ({ key, position }) => saveCheckpointPosition(key, position),
  }), [storageKey]);

  function geometry() {
    const table = tableRef.current;
    if (!table) return null;
    const phone = window.matchMedia("(max-width: 700px)").matches;
    const head = table.querySelector(".operational-collection-table-head, [data-checkpoint-header], thead");
    const headerHeight = head && getComputedStyle(head).display !== "none" ? head.getBoundingClientRect().height : 0;
    return {
      table, phone,
      top: phone ? Math.max(0, table.getBoundingClientRect().top) : Math.max(0, table.getBoundingClientRect().top + headerHeight),
      bottom: phone ? window.innerHeight : Math.min(window.innerHeight, table.getBoundingClientRect().bottom),
      scroll: phone ? window.scrollY : table.scrollTop,
    };
  }

  function rememberPosition(view = geometry()) {
    if (!view || restoring.current) return;
    const row = firstVisibleCheckpointRow(rowNodes.current, view.top);
    if (!row || row.getBoundingClientRect().top >= view.bottom) return;
    const page = Number(row.dataset.checkpointPage);
    anchor.current = { id: row.dataset.checkpointItem, offset: row.getBoundingClientRect().top - view.top, page };
    setCurrentPage((old) => old === page ? old : page);
    work.persist({ key: storageKey, position: anchor.current });
  }

  function loadAtEdge(direction, view = geometry()) {
    const state = callbacks.current;
    if (restoring.current || revision.current !== state.jumpRevision) return;
    if (!view || state.loading || state.loadingMore || state.error || !state.pages.length) return;
    const last = batchNodes.current.at(-1);
    const first = batchNodes.current[0];
    // Native scrollbar dragging can skip unloaded space. Fetch just that batch,
    // keeping the thumb at the user's chosen position instead of snapping back.
    if (first && last && (first.getBoundingClientRect().top > view.bottom || last.getBoundingClientRect().bottom < view.top)) {
      const header = view.table.querySelector(".operational-collection-table-head, [data-checkpoint-header], thead");
      const origin = view.phone ? view.table.getBoundingClientRect().top + window.scrollY : (header?.getBoundingClientRect().height || 0);
      const target = extent.pageAt(Math.max(0, view.scroll - origin));
      if (!state.pages.some((batch) => batch.page === target)) {
        skippedScroll.current = view.scroll;
        anchor.current = null;
        void state.jumpTo(target).then((loaded) => { if (!loaded) skippedScroll.current = null; });
        return;
      }
    }
    if (last && last.getBoundingClientRect().bottom < view.bottom + checkpointPrefetchDistance(view) && direction >= 0) void state.loadNext();
    else if (direction < 0 && first && first.getBoundingClientRect().top > view.top - checkpointPrefetchDistance(view)) void state.loadPrevious();
  }

  function processScroll(hint = 0) {
    const view = geometry();
    if (!view) return;
    fitViewport(view);
    const direction = view.scroll - lastScroll.current || hint;
    lastScroll.current = view.scroll;
    loadAtEdge(direction, view);
    rememberPosition(view);
  }

  function fitViewport(view) {
    if (!view.phone) {
      const surface = view.table.closest(".operational-collection-surface");
      const bottom = Math.min(window.innerHeight, surface?.getBoundingClientRect().bottom ?? window.innerHeight);
      const available = Math.max(160, bottom - Math.max(0, view.table.getBoundingClientRect().top) - 16);
      setViewportHeight((old) => old === available ? old : available);
    }
  }
  processRef.current = processScroll;
  function handleScroll() { work.schedule(); }

  useEffect(() => {
    const table = tableRef.current;
    if (!table) return;
    // React Aria collections can commit their rows after the parent's layout
    // effect. Measure that real row set once, rather than guessing its extent.
    let signature = "";
    const inspectRows = () => {
      const next = [...table.querySelectorAll("[data-checkpoint-item]")].map((node) => `${node.dataset.checkpointPage}:${node.dataset.checkpointItem}`).join("|") + [...table.querySelectorAll("[data-checkpoint-spacer]")].map((node) => `${node.dataset.checkpointSpacer}:${node.querySelector("div[style]")?.style.height}`).join("|");
      if (next !== signature) {
        signature = next;
        setRowRevision((value) => value + 1);
      }
    };
    const observer = new MutationObserver(inspectRows);
    observer.observe(table, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-checkpoint-item", "data-checkpoint-page", "style"] });
    inspectRows();
    return () => observer.disconnect();
  }, [storageKey]);

  useEffect(() => {
    const onWindowScroll = () => { if (window.matchMedia("(max-width: 700px)").matches) handleScroll(); };
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    const onPageHide = () => work.flush();
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("resize", onResize);
      work.dispose();
    };
  }, [work]);

  useLayoutEffect(() => {
    const view = geometry();
    if (view) fitViewport(view);
    rowNodes.current = [...(view?.table.querySelectorAll("[data-checkpoint-item]") || [])];
    batchNodes.current = queue.pages.map((batch) => {
      const nodes = rowNodes.current.filter((node) => Number(node.dataset.checkpointPage) === batch.page);
      return { page: batch.page, children: nodes, getBoundingClientRect: () => ({
        top: nodes[0]?.getBoundingClientRect().top ?? 0,
        bottom: nodes.at(-1)?.getBoundingClientRect().bottom ?? 0,
        height: nodes.length ? nodes.at(-1).getBoundingClientRect().bottom - nodes[0].getBoundingClientRect().top : 0,
      }) };
    }).filter((batch) => batch.children.length);
    if (!view) return;
    // Do not consume a jump revision against the prior React Aria collection.
    // Its new rows and virtual spacer heights must be committed first.
    const expectedRows = queue.pages.flatMap((batch) => batch.items.map((item) => `${batch.page}:${String(getItemKey(item))}`));
    const committedRows = rowNodes.current.map((node) => `${node.dataset.checkpointPage}:${node.dataset.checkpointItem}`);
    const committedKeys = new Set(committedRows);
    if (queue.pages.length && (expectedRows.length !== committedRows.length || expectedRows.some((key) => !committedKeys.has(key)))) return;
    if (!queue.pages.length) {
      if (previousKey.current !== storageKey) {
        restoring.current = true;
        anchor.current = null;
        skippedScroll.current = null;
      }
      if (spacing.before || spacing.after) setSpacing({ before: 0, after: 0 });
      return;
    }
    extent.measure(batchNodes.current.map((node) => ({ page: node.page, height: node.getBoundingClientRect().height, rows: node.children.length })), queue.pageCount, queue.total, view.table.getBoundingClientRect().width);
    const nextSpacing = extent.spacing(queue.pages[0].page, queue.pages.at(-1).page);
    if (Math.abs(nextSpacing.before - spacing.before) > 0.5 || Math.abs(nextSpacing.after - spacing.after) > 0.5) {
      setSpacing(nextSpacing);
      return; // Correct the anchor after spacer layout is committed.
    }
    if (view.table.querySelector(".operational-data-table")) {
      const committedHeight = (side) => Number.parseFloat(view.table.querySelector(`[data-checkpoint-spacer="${side}"] div[style]`)?.style.height || "0");
      if (Math.abs(committedHeight("before") - spacing.before) > 0.5 || Math.abs(committedHeight("after") - spacing.after) > 0.5) return;
    }
    const keyChanged = previousKey.current !== storageKey;
    const jumped = revision.current !== queue.jumpRevision;
    if (keyChanged || jumped) {
      if (keyChanged) restoring.current = true;
      previousKey.current = storageKey;
      revision.current = queue.jumpRevision;
      anchor.current = null;
    }
    const saved = restoring.current ? readCheckpointPosition(storageKey) : anchor.current;
    const row = saved?.id ? [...view.table.querySelectorAll("[data-checkpoint-item]")].find((node) => node.dataset.checkpointItem === saved.id) : null;
    if (skippedScroll.current !== null && jumped) {
      // The native position may have continued moving while the request ran.
      skippedScroll.current = null;
    } else if (row) {
      const delta = row.getBoundingClientRect().top - view.top - saved.offset;
      if (Math.abs(delta) > 0.5) {
        if (view.phone) window.scrollBy({ top: delta, behavior: "instant" });
        else view.table.scrollTop += delta;
      }
    } else if (jumped || restoring.current) {
      const targetRow = rowNodes.current[0];
      if (targetRow && (!renderItems || semanticTable)) {
        const delta = targetRow.getBoundingClientRect().top - view.top;
        if (view.phone) window.scrollBy({ top: delta, behavior: "instant" });
        else view.table.scrollTop += delta;
      } else if (view.phone) {
        view.table.scrollIntoView({ block: "start", behavior: "instant" });
        window.scrollBy({ top: spacing.before, behavior: "instant" });
      } else view.table.scrollTop = spacing.before;
    }
    restoring.current = false;
    lastScroll.current = geometry()?.scroll || 0;
    rememberPosition(geometry());
  }, [queue.pages, queue.jumpRevision, storageKey, spacing, extent, viewportWidth, rowRevision]);

  // Fill a short viewport, then prefetch only at the trailing edge.
  useEffect(() => { loadAtEdge(0); }, [queue.pages, queue.loading, queue.loadingMore, spacing]);

  function jump(page) {
    work.flush();
    restoring.current = false;
    anchor.current = null;
    skippedScroll.current = null;
    void queue.jumpTo(page);
  }

  const hasItems = queue.pages.some((batch) => batch.items.length);
  const entries = useMemo(() => queue.pages.flatMap((batch) => batch.items.map((item) => ({
    item, key: String(getItemKey(item)), page: batch.page,
    rowProps: { "data-checkpoint-item": String(getItemKey(item)), "data-checkpoint-page": batch.page },
  }))), [queue.pages, getItemKey]);
  const renderedRows = renderItems ? renderItems(entries) : entries.map(({item, key, rowProps}) => cloneElement(renderItem(item), { ...rowProps, key }));
  const semanticTable = renderedRows?.type === OperationalDataTable || renderedRows?.type === OperationalCollectionTable;
  const semanticFrameClass = renderedRows?.type === OperationalDataTable
    ? "is-data-table-frame"
    : renderedRows?.type === OperationalCollectionTable ? "is-collection-table-frame" : "";
  const footerStatus = statusPlacement === "footer";
  const reachedCount = Math.min(queue.total || 0, (queue.pages.at(-1)?.page || 0) * pageSize);
  return (
    <div className={`checkpoint-queue-table checkpoint-collection${footerStatus ? " is-footer-status" : ""}${queue.pageCount > 1 ? "" : " is-single-batch"}`} style={viewportHeight ? { "--checkpoint-viewport-height": `${viewportHeight}px` } : undefined} onClickCapture={() => work.flush()} onWheelCapture={(event) => {
      if (event.deltaY < 0) work.schedule(-1);
    }} onKeyDownCapture={(event) => {
      if (["ArrowUp", "PageUp"].includes(event.key)) work.schedule(-1);
      else if (["Enter", " "].includes(event.key)) work.flush();
    }}>
      {queue.pageCount > 1 ? <CheckpointRail label={label} pageCount={queue.pageCount} currentPage={currentPage} total={queue.total} pageSize={pageSize} onJump={jump}
        getPreview={getPreview} disabled={queue.loading} /> : null}
      {renderItems ? <div aria-label={ariaLabel} aria-busy={queue.loading || queue.loadingMore} className={`checkpoint-collection-viewport checkpoint-queue-scroll ${semanticFrameClass} ${className}`.trim()} ref={tableRef} onScroll={handleScroll}>
        {header}
        {!semanticTable ? <div className="checkpoint-queue-spacer" aria-hidden="true" style={{ height: spacing.before }} /> : null}
        {semanticTable ? cloneElement(renderedRows, { checkpointSpacing: spacing }) : renderedRows}
        {!semanticTable ? <div className="checkpoint-queue-spacer" aria-hidden="true" style={{ height: spacing.after }} /> : null}
        {!hasItems && !queue.loading && !queue.error ? children : null}
      </div> : <OperationalCollectionTable columns={columns} ariaLabel={ariaLabel} busy={queue.loading || queue.loadingMore}
        className={`${className} checkpoint-queue-scroll`} tableRef={tableRef} onScroll={handleScroll}>
        <div className="checkpoint-queue-spacer" aria-hidden="true" style={{ height: spacing.before }} />
        {renderedRows}
        <div className="checkpoint-queue-spacer" aria-hidden="true" style={{ height: spacing.after }} />
        {!hasItems && !queue.loading && !queue.error ? children : null}
      </OperationalCollectionTable>}
      {footerStatus ? <footer className="checkpoint-collection-footer" aria-label={`${ariaLabel || label} count`}>
        <span role="status">{queue.loading && !queue.pages.length ? `Loading ${label}…` : `${reachedCount.toLocaleString()} of ${Number(queue.total || 0).toLocaleString()}`}{queue.loadingMore ? " · Loading…" : ""}</span>
        {queue.error ? <span className="error" role="alert">{queue.error.message || String(queue.error)} <button type="button" onClick={() => queue.retry()}>Retry</button></span> : null}
      </footer> : <>
      {queue.loading || queue.loadingMore ? <div className="checkpoint-queue-edge checkpoint-queue-notice" role="status">Loading {label}…</div> : null}
      {queue.error ? <div className="checkpoint-queue-edge checkpoint-queue-notice error" role="alert"><span>{queue.error.message || String(queue.error)}</span><button type="button" onClick={() => queue.retry()}>Retry</button></div> : null}
      {!queue.loading && !queue.loadingMore && !queue.error && queue.total > 0 && queue.pages.length && queue.pages.at(-1).page === queue.pageCount ? <div className="checkpoint-queue-edge checkpoint-queue-notice" role="status">All {queue.total} {label} reached</div> : null}
      </>}
    </div>
  );
}

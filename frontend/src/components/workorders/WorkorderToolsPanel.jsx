import { XClose } from "@untitledui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { Heading } from "react-aria-components";
import { getNextWorkorderToolView, getVisibleWorkorderToolViews } from "./workorder-tools-panel-model.js";
import "./workorder-tools-panel.css";

const DESKTOP_MEDIA_QUERY = "(min-width: 1280px)";

function useDesktopToolsPanel() {
  const [isDesktop, setIsDesktop] = useState(() => (
    typeof window !== "undefined" && window.matchMedia(DESKTOP_MEDIA_QUERY).matches
  ));

  useEffect(() => {
    const mediaQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
    const update = () => setIsDesktop(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

function ToolsPanelBody({ activeView, onViewChange, views }) {
  const panelId = useId();
  const tabRefs = useRef(new Map());
  const viewIds = views.map(({ id }) => id);
  const selectedView = viewIds.includes(activeView) ? activeView : viewIds[0];

  const selectView = (viewId, shouldFocus = false) => {
    onViewChange?.(viewId);
    if (shouldFocus) tabRefs.current.get(viewId)?.focus();
  };

  const handleTabKeyDown = (event) => {
    const nextView = getNextWorkorderToolView(viewIds, selectedView, event.key);
    if (!nextView) return;
    event.preventDefault();
    selectView(nextView, true);
  };

  return (
    <>
      <div className="workorder-tools-panel-tabs" role="tablist" aria-label="Work order tools" onKeyDown={handleTabKeyDown}>
        {views.map((view) => (
          <button
            key={view.id}
            ref={(node) => {
              if (node) tabRefs.current.set(view.id, node);
              else tabRefs.current.delete(view.id);
            }}
            type="button"
            role="tab"
            id={`${panelId}-tab-${view.id}`}
            aria-controls={`${panelId}-view-${view.id}`}
            aria-selected={selectedView === view.id}
            tabIndex={selectedView === view.id ? 0 : -1}
            onClick={() => selectView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </div>
      <div className="workorder-tools-panel-content">
        {views.map((view) => (
          <section
            key={view.id}
            id={`${panelId}-view-${view.id}`}
            role="tabpanel"
            aria-labelledby={`${panelId}-tab-${view.id}`}
            hidden={selectedView !== view.id}
            className="workorder-tools-panel-view"
          >
            {view.content}
          </section>
        ))}
      </div>
    </>
  );
}

function ToolsPanelHeader({ onClose, isDesktop }) {
  return (
    <header className="workorder-tools-panel-header">
      <Heading slot="title">Tools</Heading>
      {!isDesktop && (
        <button type="button" onClick={onClose} aria-label="Close work order tools" title="Close work order tools">
          <XClose aria-hidden="true" />
        </button>
      )}
    </header>
  );
}

/**
 * A controlled secondary workspace for Preview, Chat, Activity, and contextual work-order tools.
 * At desktop widths callers render this as a right-hand grid column; smaller screens receive a modal.
 */
export function WorkorderToolsPanel({
  open,
  onClose,
  activeView,
  onViewChange,
  views = [],
  id = "workorder-preview-panel",
}) {
  const isDesktop = useDesktopToolsPanel();
  const visibleViews = getVisibleWorkorderToolViews(views, activeView);
  const panelRef = useRef(null);

  useEffect(() => {
    const dialog = panelRef.current;
    if (!dialog) return;
    const closeNativeDialog = () => {
      if (!dialog.open) return;
      dialog.close();
    };

    if (!open) {
      closeNativeDialog();
      return;
    }

    // A dialog cannot change between modal and non-modal while open. Closing and
    // reopening retains its React subtree, including an in-progress chat draft.
    closeNativeDialog();
    if (isDesktop) dialog.show();
    else dialog.showModal();
  }, [open, isDesktop]);

  if (!visibleViews.length) return null;

  const close = () => onClose?.();
  const handleCancel = (event) => {
    event.preventDefault();
    close();
  };
  const handleKeyDown = (event) => {
    if (isDesktop && event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  };

  return (
    <div
      className="workorder-tools-panel-overlay"
      data-open={open || undefined}
    >
      <dialog
        ref={panelRef}
        id={id}
        className="workorder-tools-panel"
        aria-label="Work order tools"
        onCancel={handleCancel}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          if (!isDesktop && event.target === event.currentTarget) {
            const rect = event.currentTarget.getBoundingClientRect();
            if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
          }
        }}
      >
        <ToolsPanelHeader onClose={close} isDesktop={isDesktop} />
        <ToolsPanelBody activeView={activeView} onViewChange={onViewChange} views={visibleViews} />
      </dialog>
    </div>
  );
}

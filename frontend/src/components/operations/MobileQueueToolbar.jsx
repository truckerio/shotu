import { useEffect, useState } from "react";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { WorkorderQueueTabs } from "../workorders/WorkorderQueue.jsx";
import { MobileQueueTools } from "./MobileQueueTools.jsx";
import "./mobile-queue-tools.css";

export function isMobileQueueSearchTarget(target) {
  if (!target || typeof target.matches !== "function") return false;
  return target.matches([
    ".mobile-filter-content input[type='search']",
    ".mobile-filter-content .mechanic-search input",
    ".mobile-filter-content .operations-search input",
  ].join(", "));
}

export function MobileQueueToolbar({
  activeTab,
  children,
  className = "",
  filtersActive = false,
  label,
  onChange,
  onClearFilters,
  tabs,
  title,
}) {
  const {
    keyboardOpen,
    viewportHeight,
    viewportOffsetTop,
  } = useVisualViewport();
  const [searchFocused, setSearchFocused] = useState(false);
  const searchKeyboardOpen = keyboardOpen && searchFocused;

  useEffect(() => {
    function updateSearchFocus(event) {
      setSearchFocused(isMobileQueueSearchTarget(event.target));
    }

    function updateAfterFocusLeaves() {
      window.requestAnimationFrame(() => {
        setSearchFocused(isMobileQueueSearchTarget(document.activeElement));
      });
    }

    document.addEventListener("focusin", updateSearchFocus);
    document.addEventListener("focusout", updateAfterFocusLeaves);
    return () => {
      document.removeEventListener("focusin", updateSearchFocus);
      document.removeEventListener("focusout", updateAfterFocusLeaves);
    };
  }, []);

  useEffect(() => {
    if (!searchKeyboardOpen) return undefined;

    const root = document.documentElement;
    const heightProperty = "--mobile-queue-visual-viewport-height";
    const offsetProperty = "--mobile-queue-visual-viewport-offset-top";
    const previousHeight = root.style.getPropertyValue(heightProperty);
    const previousOffset = root.style.getPropertyValue(offsetProperty);
    root.style.setProperty(heightProperty, viewportHeight ? `${viewportHeight}px` : "100dvh");
    root.style.setProperty(offsetProperty, `${viewportOffsetTop}px`);

    return () => {
      if (previousHeight) root.style.setProperty(heightProperty, previousHeight);
      else root.style.removeProperty(heightProperty);
      if (previousOffset) root.style.setProperty(offsetProperty, previousOffset);
      else root.style.removeProperty(offsetProperty);
    };
  }, [searchKeyboardOpen, viewportHeight, viewportOffsetTop]);

  return (
    <div
      className={`mobile-queue-toolbar${searchKeyboardOpen ? " mobile-queue-toolbar--keyboard-open" : ""} ${className}`.trim()}
      data-keyboard-open={searchKeyboardOpen ? "true" : "false"}
    >
      <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={onChange} />
      <MobileQueueTools
        label={label}
        title={title}
        filtersActive={filtersActive}
        onClearFilters={onClearFilters}
      >
        {children}
      </MobileQueueTools>
    </div>
  );
}

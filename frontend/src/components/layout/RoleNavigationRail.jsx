import { ChevronDown } from "@untitledui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Tooltip, TooltipTrigger } from "react-aria-components";
import { WorkspaceHeader } from "./WorkspaceHeader.jsx";
import "./role-navigation-rail.css";

function visible(items = []) { return items.filter((item) => item.visible !== false); }
const tabletQuery = "(min-width: 701px) and (max-width: 1199px)";

function NavigationItem({ item, active, compact, onNavigate }) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const buttonRef = useRef(null);
  const keyboardFocus = useRef(false);
  const reopenFrame = useRef(null);
  const Icon = item.icon;

  function cancelReopen() {
    if (reopenFrame.current !== null) cancelAnimationFrame(reopenFrame.current);
    reopenFrame.current = null;
  }

  function dismissTooltip() {
    keyboardFocus.current = false;
    cancelReopen();
    setTooltipOpen(false);
  }

  useEffect(() => {
    function escape(event) {
      if (event.key === "Escape" && keyboardFocus.current) dismissTooltip();
    }
    // React Aria also handles Escape in capture. A document listener ensures
    // explicit dismissal cancels reopening even when its handler stops bubbling.
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("keydown", escape, true);
      cancelReopen();
    };
  }, []);

  useEffect(() => { dismissTooltip(); }, [compact]);

  function changeTooltip(nextOpen) {
    cancelReopen();
    setTooltipOpen(nextOpen);
    if (!nextOpen && keyboardFocus.current && compact) {
      // React Aria closes on ancestor scroll/hover-end. Keyboard focus can cause
      // either after opening; reopen next frame so positioning uses the settled list.
      reopenFrame.current = requestAnimationFrame(() => {
        reopenFrame.current = null;
        if (keyboardFocus.current && buttonRef.current === document.activeElement) setTooltipOpen(true);
      });
    }
  }

  return <TooltipTrigger key={item.id} delay={250} isDisabled={!compact} isOpen={compact && tooltipOpen} onOpenChange={changeTooltip}>
    <Button ref={buttonRef} className={`role-navigation-item${active ? " active" : ""}${item.variant ? ` role-navigation-item-${item.variant}` : ""}`} aria-label={item.label} aria-current={active ? "page" : undefined}
      onFocus={(event) => {
        const button = event.currentTarget;
        keyboardFocus.current = button.matches(":focus-visible") || button.hasAttribute("data-focus-visible");
        if (compact && keyboardFocus.current) setTooltipOpen(true);
      }}
      onBlur={dismissTooltip}
      onPressStart={dismissTooltip}
      onPress={() => onNavigate(item.id)}>
      {Icon ? <Icon aria-hidden="true" /> : <span className="role-navigation-fallback" aria-hidden="true">{item.label.slice(0, 2)}</span>}
      <span className="role-navigation-item-label">{item.label}</span>
    </Button>
    <Tooltip className="role-navigation-tooltip" placement="right">{item.label}</Tooltip>
  </TooltipTrigger>;
}

export function RoleNavigationRail({ actor, locale = "en", ariaLabel = "Workspace", groups = [], items = [], activeId = "", onNavigate }) {
  const [openGroups, setOpenGroups] = useState(() => new Set(groups.map((group) => group.id)));
  const [tablet, setTablet] = useState(() => window.matchMedia(tabletQuery).matches);
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [tabletExpanded, setTabletExpanded] = useState(false);
  const railRef = useRef(null);
  const toggleRef = useRef(null);
  const listRef = useRef(null);
  const railId = useId();
  const compact = tablet ? !tabletExpanded : desktopCollapsed;
  const overlay = tablet && tabletExpanded;
  const navigationId = `${railId}-navigation`;

  useEffect(() => {
    const media = window.matchMedia(tabletQuery);
    function resize() {
      resetListScroll();
      setTablet(media.matches);
      setTabletExpanded(false);
    }
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);

  function resetListScroll() {
    // Focus must not auto-scroll a stale list position and dismiss its tooltip.
    listRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }

  function dismissOverlay(restoreFocus = false) {
    resetListScroll();
    setTabletExpanded(false);
    if (restoreFocus) toggleRef.current?.focus();
  }

  useEffect(() => {
    if (!overlay) return;
    function isAccountLayer(target) {
      // Account menus/dialogs are portalled outside the rail by React Aria.
      return target instanceof Element && target.closest(".profile-menu-popover, [role='dialog'], [data-react-aria-top-layer]");
    }
    function outside(event) {
      if (!railRef.current?.contains(event.target) && !isAccountLayer(event.target)) dismissOverlay();
    }
    function escape(event) {
      // Pointer/touch expansion need not move focus into the rail. Capture before
      // tooltips consume Escape, while letting account layers dismiss themselves.
      const accountLayerOpen = document.querySelector(".profile-menu-popover, .account-modal-overlay, .passkey-modal-overlay, .user-activity-overlay");
      if (event.key === "Escape" && !isAccountLayer(event.target) && !accountLayerOpen) {
        event.preventDefault();
        dismissOverlay(true);
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [overlay]);

  function toggleGroup(groupId) {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  const renderItem = (item) => <NavigationItem key={item.id} item={item} active={item.id === activeId} compact={compact} onNavigate={(nextId) => {
    if (overlay) dismissOverlay(true);
    onNavigate(nextId);
  }} />;
  return <aside ref={railRef} className="role-navigation-rail" data-compact={compact} data-overlay={overlay} data-tablet={tablet}>
    <WorkspaceHeader actor={actor} locale={locale} className="role-navigation-account" />
    <button ref={toggleRef} className="role-navigation-toggle" type="button" aria-label={compact ? "Expand navigation" : "Collapse navigation"} aria-expanded={!compact} aria-controls={navigationId} onClick={() => {
      resetListScroll();
      if (tablet) setTabletExpanded((current) => !current);
      else setDesktopCollapsed((current) => !current);
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16m4-11 3 3-3 3" /></svg>
      <span>Collapse navigation</span>
    </button>
    <div className="role-navigation-divider" />
    <nav ref={listRef} id={navigationId} className="role-navigation-list" aria-label={ariaLabel}>
      {groups.map((group) => {
        const groupItems = visible(group.items);
        if (!groupItems.length) return null;
        // Compact mode always exposes every permitted destination, even if its group was closed.
        const open = compact || openGroups.has(group.id);
        const regionId = `${railId}-${group.id}`;
        return <section key={group.id} aria-label={group.label}>
          {!compact ? <button className="role-navigation-group" type="button" aria-controls={regionId} aria-expanded={open} onClick={() => toggleGroup(group.id)}><span>{group.label}</span><ChevronDown aria-hidden="true" /></button> : null}
          {open ? <div id={regionId} className="role-navigation-children">{groupItems.map(renderItem)}</div> : null}
        </section>;
      })}
      {visible(items).map(renderItem)}
    </nav>
  </aside>;
}

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Settings01,
  Tool02,
  XClose,
} from "@untitledui/icons";
import { Button, Dialog, Heading, Menu, MenuItem, MenuTrigger, Modal, ModalOverlay, Popover } from "react-aria-components";
import { workorderModuleDescriptor } from "../../features/workorder-modules/workorder-module-registry.js";
import {
  arrangeWorkorderSections,
  fitWorkorderSections,
  moveOptionalWorkorderSection,
  optionalWorkorderSectionIds,
  splitWorkorderSections,
} from "./workorder-section-navigation.js";
import { interfaceText } from "../../i18n/index.js";
import "./workorder-object-page.css";

function sectionIcon(sectionId) {
  return workorderModuleDescriptor(sectionId)?.icon || Tool02;
}

function compactValue(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

export function WorkorderObjectSummary({
  concern,
  customer,
  dates,
  location,
  mechanics,
  unit,
  unitType = "Unit",
  actions,
  children,
  locale = "en",
}) {
  const t = (key) => interfaceText(locale, key);
  const headingId = useId();

  return (
    <section className="workorder-object-summary" aria-labelledby={headingId}>
      <div className="workorder-object-primary">
        <span>{t("detail.workToDo")}</span>
        <h1 id={headingId}>{compactValue(concern, t("detail.noRepairConcern"))}</h1>
      </div>
      <dl className="workorder-object-facts">
        <div>
          <dt>{compactValue(unitType, t("detail.unit"))}</dt>
          <dd>{compactValue(unit, t("detail.notListed"))}</dd>
        </div>
        <div>
          <dt>{t("location.title")}</dt>
          <dd>{compactValue(location, t("detail.notListed"))}</dd>
        </div>
        <div>
          <dt>{t("timeline.mechanics")}</dt>
          <dd>{compactValue(mechanics, t("assignment.unassigned"))}</dd>
        </div>
        <div>
          <dt>{t("unit.customer")}</dt>
          <dd>{compactValue(customer, t("detail.notListed"))}</dd>
        </div>
        <div>
          <dt>{t("schedule.workDates")}</dt>
          <dd>{compactValue(dates, t("detail.notListed"))}</dd>
        </div>
      </dl>
      {children}
      {actions ? <div className="workorder-object-actions" aria-label={t("detail.workorderActions")}>{actions}</div> : null}
    </section>
  );
}

function readOptionalSectionOrder(preferenceKey) {
  if (!preferenceKey || typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(preferenceKey) || "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function WorkorderSectionNav({ sections, activeSection, onSelect, className = "", locale = "en", preferenceKey = "" }) {
  const t = (key) => interfaceText(locale, key);
  const [visualActiveSection, setVisualActiveSection] = useState(activeSection);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [optionalOrder, setOptionalOrder] = useState(() => readOptionalSectionOrder(preferenceKey));
  const orderedSections = useMemo(
    () => arrangeWorkorderSections(sections, optionalOrder),
    [optionalOrder, sections],
  );
  const optionalSections = useMemo(() => {
    const optionalIds = new Set(optionalWorkorderSectionIds(orderedSections));
    return orderedSections.filter(({ id }) => optionalIds.has(id));
  }, [orderedSections]);
  const [desktopLayout, setDesktopLayout] = useState(() => ({
    primarySections: orderedSections,
    overflowSections: [],
  }));
  const desktopNavRef = useRef(null);
  const measurementRef = useRef(null);
  const phoneLayout = splitWorkorderSections(orderedSections);
  const desktopActiveOverflowSection = desktopLayout.overflowSections.find(({ id }) => id === visualActiveSection);
  const phoneActiveOverflowSection = phoneLayout.overflowSections.find(({ id }) => id === visualActiveSection);

  useEffect(() => {
    setVisualActiveSection(activeSection);
  }, [activeSection]);

  useEffect(() => {
    setOptionalOrder(readOptionalSectionOrder(preferenceKey));
  }, [preferenceKey]);

  useLayoutEffect(() => {
    const nav = desktopNavRef.current;
    const measurement = measurementRef.current;
    if (!nav || !measurement) return undefined;

    function measure() {
      const style = window.getComputedStyle(nav);
      const availableWidth = nav.clientWidth
        - (Number.parseFloat(style.paddingLeft) || 0)
        - (Number.parseFloat(style.paddingRight) || 0)
        - (nav.querySelector("[data-arrange-tabs]")?.getBoundingClientRect().width || 0);
      const sectionWidths = Object.fromEntries(
        [...measurement.querySelectorAll("[data-measure-section-id]")].map((element) => [
          element.dataset.measureSectionId,
          element.getBoundingClientRect().width,
        ]),
      );
      const moreWidth = measurement.querySelector("[data-measure-more]")?.getBoundingClientRect().width || 0;
      setDesktopLayout(fitWorkorderSections(orderedSections, { availableWidth, sectionWidths, moreWidth }));
    }

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [orderedSections]);

  function SectionContent({ section, showIcon = false }) {
    const Icon = sectionIcon(section.id);
    return (
      <>
        {showIcon ? <Icon aria-hidden="true" /> : null}
        <span>{section.label}</span>
        {section.count !== undefined && section.count !== null ? <small>{section.count}</small> : null}
      </>
    );
  }

  function selectSection(sectionId) {
    setVisualActiveSection(sectionId);
    onSelect(sectionId);
  }

  function saveOptionalOrder(nextOrder) {
    setOptionalOrder(nextOrder);
    if (!preferenceKey || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(preferenceKey, JSON.stringify(nextOrder));
    } catch {
      // Keep the in-session order when private browsing or storage policy blocks persistence.
    }
  }

  function moveOptionalSection(sectionId, direction) {
    saveOptionalOrder(moveOptionalWorkorderSection(optionalWorkorderSectionIds(orderedSections), sectionId, direction));
  }

  function resetOptionalOrder() {
    setOptionalOrder([]);
    if (!preferenceKey || typeof window === "undefined") return;
    try {
      window.localStorage.removeItem(preferenceKey);
    } catch {
      // The in-session reset still succeeds when storage is unavailable.
    }
  }

  return (
    <>
      <nav
        className={`workorder-section-nav workorder-section-nav-desktop ${className}`.trim()}
        aria-label={t("detail.workorderSections")}
        ref={desktopNavRef}
      >
        {desktopLayout.primarySections.map((section) => (
          <button
            className={`${visualActiveSection === section.id ? "is-active" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
            type="button"
            key={section.id}
            data-section-id={section.id}
            aria-current={visualActiveSection === section.id ? "page" : undefined}
            onClick={() => selectSection(section.id)}
          >
            <SectionContent section={section} />
          </button>
        ))}
        {desktopLayout.overflowSections.length ? (
          <MenuTrigger>
            <Button
              className={`${desktopActiveOverflowSection ? "is-active" : ""} ${desktopActiveOverflowSection?.attention ? "has-attention" : ""}`.trim()}
              aria-current={desktopActiveOverflowSection ? "page" : undefined}
              aria-label={desktopActiveOverflowSection ? `${t("detail.moreSections")}, ${desktopActiveOverflowSection.label} ${t("detail.selected")}` : t("detail.moreWorkorderSections")}
            >
              <span>{t("detail.more")}</span>
              <ChevronDown aria-hidden="true" />
            </Button>
            <Popover className="workorder-section-more-popover" placement="bottom end">
              <Menu className="workorder-section-more-menu" aria-label={t("detail.moreWorkorderSections")}>
                {desktopLayout.overflowSections.map((section) => {
                  const Icon = sectionIcon(section.id);
                  return (
                    <MenuItem
                      className={`${visualActiveSection === section.id ? "is-selected" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
                      key={section.id}
                      id={section.id}
                      data-section-id={section.id}
                      textValue={section.label}
                      onAction={() => selectSection(section.id)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{section.label}</span>
                      {section.count !== undefined ? <small>{section.count}</small> : null}
                    </MenuItem>
                  );
                })}
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : null}
        {optionalSections.length > 1 ? (
          <button
            className="workorder-section-arrange-trigger"
            type="button"
            data-arrange-tabs
            aria-label={t("detail.arrangeTabs")}
            title={t("detail.arrangeTabs")}
            onClick={() => setArrangeOpen(true)}
          >
            <Settings01 aria-hidden="true" />
          </button>
        ) : null}
        <div className="workorder-section-nav-measurement" aria-hidden="true" ref={measurementRef}>
          {orderedSections.map((section) => (
            <span className="workorder-section-nav-measure-item" data-measure-section-id={section.id} key={section.id}>
              <SectionContent section={section} />
            </span>
          ))}
          <span className="workorder-section-nav-measure-item" data-measure-more>
            <span>{t("detail.more")}</span>
            <ChevronDown aria-hidden="true" />
          </span>
        </div>
      </nav>

      <nav className={`workorder-section-nav-mobile ${className}`.trim()} aria-label={t("detail.workorderSections")}>
        {phoneLayout.primarySections.map((section) => (
          <button
            className={`${visualActiveSection === section.id ? "is-active" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
            type="button"
            key={section.id}
            data-section-id={section.id}
            aria-current={visualActiveSection === section.id ? "page" : undefined}
            onClick={() => selectSection(section.id)}
          >
            <SectionContent section={section} showIcon />
          </button>
        ))}
        {phoneLayout.overflowSections.length ? (
          <MenuTrigger>
            <Button
              className={`${phoneActiveOverflowSection ? "is-active" : ""} ${phoneActiveOverflowSection?.attention ? "has-attention" : ""}`.trim()}
              aria-current={phoneActiveOverflowSection ? "page" : undefined}
              aria-label={phoneActiveOverflowSection ? `${t("detail.moreSections")}, ${phoneActiveOverflowSection.label} ${t("detail.selected")}` : t("detail.moreWorkorderSections")}
            >
              <span>{t("detail.more")}</span>
              {phoneActiveOverflowSection?.count !== undefined ? <small>{phoneActiveOverflowSection.count}</small> : null}
            </Button>
            <Popover className="workorder-section-more-popover" placement="top end">
              <Menu className="workorder-section-more-menu" aria-label={t("detail.moreWorkorderSections")}>
                {phoneLayout.overflowSections.map((section) => {
                  const Icon = sectionIcon(section.id);
                  return (
                    <MenuItem
                      className={`${visualActiveSection === section.id ? "is-selected" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
                      key={section.id}
                      id={section.id}
                      data-section-id={section.id}
                      textValue={section.label}
                      onAction={() => selectSection(section.id)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{section.label}</span>
                      {section.count !== undefined ? <small>{section.count}</small> : null}
                    </MenuItem>
                  );
                })}
                {optionalSections.length > 1 ? (
                  <MenuItem
                    className="workorder-section-arrange-menu-item"
                    id="arrange-tabs"
                    textValue={t("detail.arrangeTabs")}
                    onAction={() => setArrangeOpen(true)}
                  >
                    <Settings01 aria-hidden="true" />
                    <span>{t("detail.arrangeTabs")}</span>
                  </MenuItem>
                ) : null}
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : null}
      </nav>
      <ModalOverlay
        className="workorder-section-arrange-overlay"
        isOpen={arrangeOpen}
        isDismissable
        onOpenChange={setArrangeOpen}
      >
        <Modal className="workorder-section-arrange-modal">
          <Dialog className="workorder-section-arrange-dialog" aria-label={t("detail.arrangeTabs")}>
            <div className="workorder-section-arrange-heading">
              <div>
                <Heading slot="title">{t("detail.arrangeTabs")}</Heading>
                <p>{t("detail.coreTabsStayFirst")}</p>
              </div>
              <button type="button" aria-label={t("common.close")} onClick={() => setArrangeOpen(false)}>
                <XClose aria-hidden="true" />
              </button>
            </div>
            <ol className="workorder-section-arrange-list">
              {optionalSections.map((section, index) => (
                <li key={section.id}>
                  <span>{section.label}</span>
                  <div>
                    <button
                      type="button"
                      aria-label={`${t("detail.moveEarlier")} ${section.label}`}
                      title={t("detail.moveEarlier")}
                      disabled={index === 0}
                      onClick={() => moveOptionalSection(section.id, "earlier")}
                    >
                      <ArrowUp aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${t("detail.moveLater")} ${section.label}`}
                      title={t("detail.moveLater")}
                      disabled={index === optionalSections.length - 1}
                      onClick={() => moveOptionalSection(section.id, "later")}
                    >
                      <ArrowDown aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <div className="workorder-section-arrange-actions">
              <button type="button" onClick={resetOptionalOrder}>{t("detail.resetTabOrder")}</button>
              <button type="button" className="is-primary" onClick={() => setArrangeOpen(false)}>{t("common.done")}</button>
            </div>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}

export function ProgressiveWorkorderSection({
  id,
  title,
  summary,
  headerAction = null,
  activeSection,
  onSelect,
  attention = false,
  children,
  className = "",
  displayMode = "accordion",
  keepMounted = false,
  showTitle = true,
}) {
  const panelId = useId();
  const open = activeSection === id;

  if (displayMode === "panel") {
    if (!open && !keepMounted) return null;
    return (
      <section
        className={`workorder-section-panel ${open ? "" : "is-hidden"} ${attention ? "has-attention" : ""} ${className}`.trim()}
        id={panelId}
        role="tabpanel"
        aria-label={title}
        hidden={!open}
      >
        {showTitle || headerAction ? (
          <div className={`workorder-section-panel-heading ${showTitle ? "" : "is-action-only"}`.trim()}>
            {showTitle ? <div><h2>{title}</h2>{summary ? <p>{summary}</p> : null}</div> : null}
            {headerAction ? <div className="workorder-section-panel-action">{headerAction}</div> : null}
          </div>
        ) : null}
        <div className="workorder-section-panel-content">
          {children}
        </div>
      </section>
    );
  }

  return (
    <section className={`workorder-progressive-section ${open ? "is-open" : ""} ${attention ? "has-attention" : ""} ${className}`.trim()}>
      <button
        className="workorder-progressive-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onSelect(open ? "" : id)}
      >
        <span className="workorder-progressive-label">{title}</span>
        <small>{summary}</small>
        <ChevronDown aria-hidden="true" />
      </button>
      {open ? (
        <div className="workorder-progressive-content" id={panelId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

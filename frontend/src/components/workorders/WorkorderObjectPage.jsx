import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Tool02,
} from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { workorderModuleDescriptor } from "../../features/workorder-modules/workorder-module-registry.js";
import { fitWorkorderSections, splitWorkorderSections } from "./workorder-section-navigation.js";
import "./workorder-object-page.css";

function sectionIcon(sectionId) {
  return workorderModuleDescriptor(sectionId)?.icon || Tool02;
}

function compactValue(value, fallback = "Not listed") {
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
}) {
  const headingId = useId();

  return (
    <section className="workorder-object-summary" aria-labelledby={headingId}>
      <div className="workorder-object-primary">
        <span>Work to do</span>
        <h1 id={headingId}>{compactValue(concern, "No repair concern listed")}</h1>
      </div>
      <dl className="workorder-object-facts">
        <div>
          <dt>{compactValue(unitType, "Unit")}</dt>
          <dd>{compactValue(unit)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{compactValue(location)}</dd>
        </div>
        <div>
          <dt>Mechanics</dt>
          <dd>{compactValue(mechanics, "Unassigned")}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{compactValue(customer)}</dd>
        </div>
        <div>
          <dt>Work dates</dt>
          <dd>{compactValue(dates)}</dd>
        </div>
      </dl>
      {children}
      {actions ? <div className="workorder-object-actions" aria-label="Workorder actions">{actions}</div> : null}
    </section>
  );
}

export function WorkorderSectionNav({ sections, activeSection, onSelect, className = "" }) {
  const [visualActiveSection, setVisualActiveSection] = useState(activeSection);
  const [desktopLayout, setDesktopLayout] = useState(() => ({
    primarySections: sections,
    overflowSections: [],
  }));
  const desktopNavRef = useRef(null);
  const measurementRef = useRef(null);
  const phoneLayout = splitWorkorderSections(sections);
  const desktopActiveOverflowSection = desktopLayout.overflowSections.find(({ id }) => id === visualActiveSection);
  const phoneActiveOverflowSection = phoneLayout.overflowSections.find(({ id }) => id === visualActiveSection);

  useEffect(() => {
    setVisualActiveSection(activeSection);
  }, [activeSection]);

  useLayoutEffect(() => {
    const nav = desktopNavRef.current;
    const measurement = measurementRef.current;
    if (!nav || !measurement) return undefined;

    function measure() {
      const style = window.getComputedStyle(nav);
      const availableWidth = nav.clientWidth
        - (Number.parseFloat(style.paddingLeft) || 0)
        - (Number.parseFloat(style.paddingRight) || 0);
      const sectionWidths = Object.fromEntries(
        [...measurement.querySelectorAll("[data-measure-section-id]")].map((element) => [
          element.dataset.measureSectionId,
          element.getBoundingClientRect().width,
        ]),
      );
      const moreWidth = measurement.querySelector("[data-measure-more]")?.getBoundingClientRect().width || 0;
      setDesktopLayout(fitWorkorderSections(sections, { availableWidth, sectionWidths, moreWidth }));
    }

    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [sections]);

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

  return (
    <>
      <nav
        className={`workorder-section-nav workorder-section-nav-desktop ${className}`.trim()}
        aria-label="Workorder sections"
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
              aria-label={desktopActiveOverflowSection ? `More sections, ${desktopActiveOverflowSection.label} selected` : "More workorder sections"}
            >
              <span>More</span>
              <ChevronDown aria-hidden="true" />
            </Button>
            <Popover className="workorder-section-more-popover" placement="bottom end">
              <Menu className="workorder-section-more-menu" aria-label="More workorder sections">
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
        <div className="workorder-section-nav-measurement" aria-hidden="true" ref={measurementRef}>
          {sections.map((section) => (
            <span className="workorder-section-nav-measure-item" data-measure-section-id={section.id} key={section.id}>
              <SectionContent section={section} />
            </span>
          ))}
          <span className="workorder-section-nav-measure-item" data-measure-more>
            <span>More</span>
            <ChevronDown aria-hidden="true" />
          </span>
        </div>
      </nav>

      <nav className={`workorder-section-nav-mobile ${className}`.trim()} aria-label="Workorder sections">
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
              aria-label={phoneActiveOverflowSection ? `More sections, ${phoneActiveOverflowSection.label} selected` : "More workorder sections"}
            >
              <span>More</span>
              {phoneActiveOverflowSection?.count !== undefined ? <small>{phoneActiveOverflowSection.count}</small> : null}
            </Button>
            <Popover className="workorder-section-more-popover" placement="top end">
              <Menu className="workorder-section-more-menu" aria-label="More workorder sections">
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
              </Menu>
            </Popover>
          </MenuTrigger>
        ) : null}
      </nav>
    </>
  );
}

export function ProgressiveWorkorderSection({
  id,
  title,
  summary,
  activeSection,
  onSelect,
  attention = false,
  children,
  className = "",
  displayMode = "accordion",
  keepMounted = false,
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
        <div className="workorder-section-panel-heading">
          <div>
            <h2>{title}</h2>
            {summary ? <p>{summary}</p> : null}
          </div>
        </div>
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

import { useEffect, useId, useState } from "react";
import {
  ChevronDown,
  Tool02,
} from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { workorderModuleDescriptor } from "../../features/workorder-modules/workorder-module-registry.js";
import { splitWorkorderSections } from "./workorder-section-navigation.js";
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

export function WorkorderSectionNav({ sections, activeSection, onSelect }) {
  const [visualActiveSection, setVisualActiveSection] = useState(activeSection);
  const { primarySections, overflowSections } = splitWorkorderSections(sections);
  const activeOverflowSection = overflowSections.find(({ id }) => id === visualActiveSection);

  useEffect(() => {
    setVisualActiveSection(activeSection);
  }, [activeSection]);

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
      <nav className="workorder-section-nav workorder-section-nav-desktop" aria-label="Workorder sections">
        {primarySections.map((section) => (
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
        {overflowSections.length ? (
          <MenuTrigger>
            <Button
              className={`${activeOverflowSection ? "is-active" : ""} ${activeOverflowSection?.attention ? "has-attention" : ""}`.trim()}
              aria-label={activeOverflowSection ? `More sections, ${activeOverflowSection.label} selected` : "More workorder sections"}
            >
              <span>{activeOverflowSection?.label || "More"}</span>
              <ChevronDown aria-hidden="true" />
            </Button>
            <Popover className="workorder-section-more-popover" placement="bottom end">
              <Menu className="workorder-section-more-menu" aria-label="More workorder sections">
                {overflowSections.map((section) => {
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

      <nav className="workorder-section-nav-mobile" aria-label="Workorder sections">
        {primarySections.map((section) => (
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
        {overflowSections.length ? (
          <MenuTrigger>
            <Button
              className={`${activeOverflowSection ? "is-active" : ""} ${activeOverflowSection?.attention ? "has-attention" : ""}`.trim()}
              aria-label={activeOverflowSection ? `More sections, ${activeOverflowSection.label} selected` : "More workorder sections"}
            >
              <span>{activeOverflowSection?.label || "More"}</span>
              {activeOverflowSection?.count !== undefined ? <small>{activeOverflowSection.count}</small> : null}
            </Button>
            <Popover className="workorder-section-more-popover" placement="top end">
              <Menu className="workorder-section-more-menu" aria-label="More workorder sections">
                {overflowSections.map((section) => {
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

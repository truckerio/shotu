import { useId } from "react";
import {
  ChevronDown,
  ClockRewind,
  DotsHorizontal,
  MessageChatCircle,
  Package,
  Tool02,
  Truck01,
  Users01,
} from "@untitledui/icons";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import "./workorder-object-page.css";

const SECTION_ICONS = Object.freeze({
  activity: ClockRewind,
  chat: MessageChatCircle,
  parts: Package,
  team: Users01,
  unit: Truck01,
  work: Tool02,
});

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
  const primarySections = sections.length > 5 ? sections.slice(0, 4) : sections;
  const overflowSections = sections.length > 5 ? sections.slice(4) : [];
  const activeOverflowSection = overflowSections.find(({ id }) => id === activeSection);

  function SectionContent({ section, showIcon = false }) {
    const Icon = SECTION_ICONS[section.id] || Tool02;
    return (
      <>
        {showIcon ? <Icon aria-hidden="true" /> : null}
        <span>{section.label}</span>
        {section.count !== undefined && section.count !== null ? <small>{section.count}</small> : null}
      </>
    );
  }

  return (
    <>
      <nav className="workorder-section-nav workorder-section-nav-desktop" aria-label="Workorder sections">
        {sections.map((section) => (
          <button
            className={`${activeSection === section.id ? "is-active" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
            type="button"
            key={section.id}
            aria-current={activeSection === section.id ? "page" : undefined}
            onClick={() => onSelect(section.id)}
          >
            <SectionContent section={section} />
          </button>
        ))}
      </nav>

      <nav className="workorder-section-nav-mobile" aria-label="Workorder sections">
        {primarySections.map((section) => (
          <button
            className={`${activeSection === section.id ? "is-active" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
            type="button"
            key={section.id}
            aria-current={activeSection === section.id ? "page" : undefined}
            onClick={() => onSelect(section.id)}
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
              <DotsHorizontal aria-hidden="true" />
              <span>{activeOverflowSection?.label || "More"}</span>
              {activeOverflowSection?.count !== undefined ? <small>{activeOverflowSection.count}</small> : null}
            </Button>
            <Popover className="workorder-section-more-popover" placement="top end">
              <Menu className="workorder-section-more-menu" aria-label="More workorder sections">
                {overflowSections.map((section) => {
                  const Icon = SECTION_ICONS[section.id] || Tool02;
                  return (
                    <MenuItem
                      className={`${activeSection === section.id ? "is-selected" : ""} ${section.attention ? "has-attention" : ""}`.trim()}
                      key={section.id}
                      id={section.id}
                      textValue={section.label}
                      onAction={() => onSelect(section.id)}
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
}) {
  const panelId = useId();
  const open = activeSection === id;

  if (displayMode === "panel") {
    if (!open) return null;
    return (
      <section
        className={`workorder-section-panel ${attention ? "has-attention" : ""} ${className}`.trim()}
        id={panelId}
        role="tabpanel"
        aria-label={title}
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

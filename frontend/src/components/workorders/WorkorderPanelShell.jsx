import { ArrowLeft } from "@untitledui/icons";
import { WorkorderDetailLayout } from "./WorkorderDetailLayout.jsx";
import { WorkorderObjectSummary, WorkorderPresentationContext, WorkorderSectionNav } from "./WorkorderObjectPage.jsx";

/**
 * Canonical workorder editor panel. Create and existing-detail screens supply
 * their domain-specific actions and content, but the panel geometry and its
 * header, summary, section rail, and supporting-pane relationship stay here.
 */
export function WorkorderPanelShell({
  children,
  context,
  controlClassName = "",
  controlRef,
  detail = false,
  footer,
  locale = "en",
  notice,
  previewOpen,
  presentation = "panel",
  sectionClassName = "",
  sections,
  summary,
  supportingPane,
}) {
  const { children: summaryChildren, ...summaryProps } = summary;
  const onePage = presentation === "one-page";
  const coreSectionIds = onePage
    ? ["unit", "schedule", "concern", "diagnosisRepair", "parts", "assignment", "location"]
    : [];

  return (
    <WorkorderDetailLayout detail={detail} previewOpen={previewOpen} locale={locale} tools={detail && onePage}>
      <aside
        className={`control-panel ${controlClassName}`.trim()}
        data-workorder-presentation={presentation}
        ref={controlRef}
      >
        <div className={`detail-context-bar ${context.className || ""}`.trim()}>
          <div className="workorder-context-main">
            {context.back ? (
              <button
                type="button"
                onClick={context.back.onClick}
                aria-label={context.back.label}
                title={context.back.label}
              >
                <ArrowLeft />
              </button>
            ) : context.leading}
            <div className="workorder-context-content">
              {context.content || (
                <>
                  <strong>{context.title}</strong>
                  {context.subtitle ? <span>{context.subtitle}</span> : null}
                </>
              )}
            </div>
          </div>
          <div className="detail-context-actions">
            {context.status}
            {context.actions}
          </div>
        </div>

        {notice}
        {onePage ? <div className="workorder-one-page-notices">{summaryChildren}</div> : null}

        {!onePage ? (
          <>
            <WorkorderObjectSummary {...summaryProps} locale={locale}>
              {summaryChildren}
            </WorkorderObjectSummary>
            <WorkorderSectionNav
              className={sectionClassName}
              sections={sections.items}
              activeSection={sections.activeId}
              onSelect={sections.onSelect}
              locale={locale}
              preferenceKey={sections.preferenceKey}
            />
          </>
        ) : null}
        <WorkorderPresentationContext.Provider value={{ coreSectionIds, mode: presentation }}>
          {children}
        </WorkorderPresentationContext.Provider>
        {footer}
      </aside>
      {supportingPane}
    </WorkorderDetailLayout>
  );
}

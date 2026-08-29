import { ArrowLeft } from "@untitledui/icons";
import { WorkorderDetailLayout } from "./WorkorderDetailLayout.jsx";
import { WorkorderObjectSummary, WorkorderSectionNav } from "./WorkorderObjectPage.jsx";

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
  sectionClassName = "",
  sections,
  summary,
  supportingPane,
}) {
  const { children: summaryChildren, ...summaryProps } = summary;

  return (
    <WorkorderDetailLayout detail={detail} previewOpen={previewOpen} locale={locale}>
      <aside className={`control-panel ${controlClassName}`.trim()} ref={controlRef}>
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
        {children}
        {footer}
      </aside>
      {supportingPane}
    </WorkorderDetailLayout>
  );
}

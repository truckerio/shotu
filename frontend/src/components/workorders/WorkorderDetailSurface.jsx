import { ContextBreadcrumbs } from "../ui/ContextBreadcrumbs.jsx";
import { WorkorderDetailLayout } from "./WorkorderDetailLayout.jsx";
import { WorkorderObjectSummary, WorkorderSectionNav } from "./WorkorderObjectPage.jsx";
import { interfaceText } from "../../i18n/index.js";

export function WorkorderDetailSurface({
  previewOpen,
  controlRef,
  controlClassName = "",
  context,
  notice,
  summary,
  sections,
  supportingPane,
  children,
  locale = "en",
}) {
  const { children: summaryChildren, ...summaryProps } = summary;

  return (
    <WorkorderDetailLayout detail previewOpen={previewOpen} locale={locale}>
      <aside className={`control-panel ${controlClassName}`.trim()} ref={controlRef}>
        <ContextBreadcrumbs items={[context.parent]} current={context.current} ariaLabel={interfaceText(locale, "detail.breadcrumb")} />
        <div className="detail-context-bar">
          <div>
            <strong>{context.title}</strong>
            <span>{context.subtitle}</span>
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
          sections={sections.items}
          activeSection={sections.activeId}
          onSelect={sections.onSelect}
          locale={locale}
        />
        {children}
      </aside>
      {supportingPane}
    </WorkorderDetailLayout>
  );
}

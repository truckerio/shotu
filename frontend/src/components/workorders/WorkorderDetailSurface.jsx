import { ArrowLeft } from "@untitledui/icons";
import { WorkorderDetailLayout } from "./WorkorderDetailLayout.jsx";
import { WorkorderObjectSummary, WorkorderSectionNav } from "./WorkorderObjectPage.jsx";

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
}) {
  const { children: summaryChildren, ...summaryProps } = summary;

  return (
    <WorkorderDetailLayout detail previewOpen={previewOpen}>
      <aside className={`control-panel ${controlClassName}`.trim()} ref={controlRef}>
        <div className="detail-context-bar">
          <button
            type="button"
            onClick={context.onBack}
            aria-label={context.backLabel}
            title={context.backLabel}
          >
            <ArrowLeft />
          </button>
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

        <WorkorderObjectSummary {...summaryProps}>
          {summaryChildren}
        </WorkorderObjectSummary>
        <WorkorderSectionNav
          sections={sections.items}
          activeSection={sections.activeId}
          onSelect={sections.onSelect}
        />
        {children}
      </aside>
      {supportingPane}
    </WorkorderDetailLayout>
  );
}

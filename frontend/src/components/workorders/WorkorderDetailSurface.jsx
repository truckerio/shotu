import { WorkorderPanelShell } from "./WorkorderPanelShell.jsx";

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
  return (
    <WorkorderPanelShell
      controlClassName={controlClassName}
      controlRef={controlRef}
      context={{
        ...context,
        back: {
          label: context.parent.label,
          onClick: context.parent.onClick,
        },
      }}
      detail
      locale={locale}
      notice={notice}
      previewOpen={previewOpen}
      sections={sections}
      summary={summary}
      supportingPane={supportingPane}
    >
      {children}
    </WorkorderPanelShell>
  );
}

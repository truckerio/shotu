import { useContext } from "react";
import { WorkorderPresentationContext } from "../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderFormLayout } from "../../components/workorders/WorkorderFormLayout.jsx";
import { WorkorderActivityModule } from "./activity/WorkorderActivityModule.jsx";
import { WorkorderAssignmentModule } from "./assignment/WorkorderAssignmentModule.jsx";
import { WorkorderChatModule } from "./chat/WorkorderChatModule.jsx";
import { WorkorderCompletionModule } from "./completion/WorkorderCompletionModule.jsx";
import { WorkorderDiagnosisRepairModule } from "./diagnosis-repair/WorkorderDiagnosisRepairModule.jsx";
import { WorkorderLocationModule } from "./location/WorkorderLocationModule.jsx";
import { WorkorderOdooModule } from "./odoo/WorkorderOdooModule.jsx";
import { WorkorderPartsModule } from "./parts/WorkorderPartsModule.jsx";
import { WorkorderPhotosModule } from "./photos/WorkorderPhotosModule.jsx";
import { WorkorderScheduleModule } from "./schedule/WorkorderScheduleModule.jsx";
import { WorkorderUnitModule } from "./unit/WorkorderUnitModule.jsx";
import { WorkorderConcernModule } from "./work/WorkorderConcernModule.jsx";
import { moduleRenderer } from "./module-renderer-catalog.js";

const ONE_PAGE_CORE_IDS = ["unit", "schedule", "concern", "diagnosisRepair", "parts", "assignment"];

export const DETAIL_MODULE_RENDERERS = Object.freeze({
  activity: WorkorderActivityModule,
  assignment: WorkorderAssignmentModule,
  chat: WorkorderChatModule,
  completion: WorkorderCompletionModule,
  concern: WorkorderConcernModule,
  diagnosisRepair: WorkorderDiagnosisRepairModule,
  location: WorkorderLocationModule,
  odoo: WorkorderOdooModule,
  parts: WorkorderPartsModule,
  photos: WorkorderPhotosModule,
  schedule: WorkorderScheduleModule,
  unit: WorkorderUnitModule,
});

export function detailModuleRenderer(moduleId, renderers = DETAIL_MODULE_RENDERERS) {
  return moduleRenderer(moduleId, renderers);
}

function orderedOnePageSections(sections) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  return [
    ...ONE_PAGE_CORE_IDS.map((id) => byId.get(id)).filter(Boolean),
    ...sections.filter((section) => !ONE_PAGE_CORE_IDS.includes(section.id)),
  ];
}

export function WorkorderDetailModuleHost({ moduleProps = {}, renderers = DETAIL_MODULE_RENDERERS, sections = [], supportingOnly = false, conversation = null }) {
  const presentation = useContext(WorkorderPresentationContext);
  const onePage = presentation.mode === "one-page";
  const orderedSections = onePage ? orderedOnePageSections(sections) : sections;
  const renderSection = (section, { allowSupporting = false, presentation: sectionPresentation, ...extraProps } = {}) => {
    if (!allowSupporting && section.modulePolicy?.descriptor?.placementBySurface?.detail === "supporting") return null;
    const Renderer = detailModuleRenderer(section.id, renderers);
    if (!Renderer) return null;
    return <Renderer key={section.id} access={section.access} {...moduleProps[section.id]} {...extraProps} presentation={sectionPresentation} />;
  };

  if (supportingOnly) {
    return (
      <WorkorderPresentationContext.Provider value={{ ...presentation, mode: "panel" }}>
        {sections.map((section) => renderSection(section, { allowSupporting: true }))}
      </WorkorderPresentationContext.Provider>
    );
  }

  if (onePage) {
    const coreSections = orderedSections.filter((section) => ONE_PAGE_CORE_IDS.includes(section.id));
    const locationSection = orderedSections.find((section) => section.id === "location");
    return (
      <WorkorderFormLayout
        location={locationSection ? renderSection(locationSection, { presentation: "one-page", embedded: true }) : null}
        unit={coreSections.filter(({ id }) => id === "unit").map((section) => renderSection(section, {
          presentation: "one-page",
          locationContent: locationSection ? renderSection(locationSection, { presentation: "one-page", mapOnly: true }) : null,
        }))}
        concern={coreSections.filter(({ id }) => id === "concern").map((section) => renderSection(section, { presentation: "one-page" }))}
        conversation={conversation}
        schedule={coreSections.filter(({ id }) => id === "schedule").map((section) => renderSection(section, { presentation: "one-page" }))}
        assignment={coreSections.filter(({ id }) => id === "assignment").map((section) => renderSection(section, { presentation: "one-page" }))}
        parts={coreSections.filter(({ id }) => id === "parts").map((section) => renderSection(section, { presentation: "one-page" }))}
      />
    );
  }

  return (
    <div className="accordion-stack workorder-progressive-stack">
      {sections.map((section) => {
        if (section.modulePolicy?.descriptor?.placementBySurface?.detail === "supporting") return null;
        const Renderer = detailModuleRenderer(section.id, renderers);
        if (!Renderer) return null;
        return <Renderer key={section.id} access={section.access} {...moduleProps[section.id]} />;
      })}
    </div>
  );
}

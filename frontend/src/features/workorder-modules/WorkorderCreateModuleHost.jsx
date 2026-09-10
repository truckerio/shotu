import { CreateAssignmentModule } from "./assignment/CreateAssignmentModule.jsx";
import { CreateLocationModule } from "./location/CreateLocationModule.jsx";
import { CreatePartsModule } from "./parts/CreatePartsModule.jsx";
import { CreateScheduleModule } from "./schedule/CreateScheduleModule.jsx";
import { CreateUnitModule } from "./unit/CreateUnitModule.jsx";
import { CreateConcernModule } from "./work/CreateConcernModule.jsx";
import { WorkorderFormLayout } from "../../components/workorders/WorkorderFormLayout.jsx";
import { moduleRenderer } from "./module-renderer-catalog.js";

const ONE_PAGE_CORE_IDS = ["unit", "schedule", "concern", "parts", "assignment"];

export const CREATE_MODULE_RENDERERS = Object.freeze({
  assignment: CreateAssignmentModule,
  concern: CreateConcernModule,
  location: CreateLocationModule,
  parts: CreatePartsModule,
  schedule: CreateScheduleModule,
  unit: CreateUnitModule,
});

export function createModuleRenderer(moduleId, renderers = CREATE_MODULE_RENDERERS) {
  return moduleRenderer(moduleId, renderers);
}

function orderedOnePageSections(sections) {
  const byId = new Map(sections.map((section) => [section.id, section]));
  return [
    ...ONE_PAGE_CORE_IDS.map((id) => byId.get(id)).filter(Boolean),
    ...sections.filter((section) => !ONE_PAGE_CORE_IDS.includes(section.id)),
  ];
}

export function WorkorderCreateModuleHost({ moduleProps = {}, presentation = "panel", renderers = CREATE_MODULE_RENDERERS, sections = [] }) {
  const onePage = presentation === "one-page";
  const orderedSections = onePage ? orderedOnePageSections(sections) : sections;
  const renderSection = (section, extraProps = {}) => {
    if (section.modulePolicy?.descriptor?.placementBySurface?.create === "supporting") return null;
    const Renderer = createModuleRenderer(section.id, renderers);
    if (!Renderer) return null;
    return <Renderer key={section.id} access={section.access} {...moduleProps[section.id]} {...extraProps} />;
  };

  if (onePage) {
    const coreSections = orderedSections.filter((section) => ONE_PAGE_CORE_IDS.includes(section.id));
    const locationSection = orderedSections.find((section) => section.id === "location");
    const unitSection = coreSections.find(({ id }) => id === "unit");
    return (
      <WorkorderFormLayout
        location={locationSection ? renderSection(locationSection, { embedded: true, showMap: !unitSection }) : null}
        unit={unitSection ? renderSection(unitSection, {
          locationContent: locationSection ? renderSection(locationSection, { mapOnly: true }) : null,
        }) : null}
        concern={coreSections.filter(({ id }) => id === "concern").map(renderSection)}
        schedule={coreSections.filter(({ id }) => id === "schedule").map(renderSection)}
        assignment={coreSections.filter(({ id }) => id === "assignment").map(renderSection)}
        parts={coreSections.filter(({ id }) => id === "parts").map(renderSection)}
      />
    );
  }

  return (
    <div className="accordion-stack workorder-progressive-stack create-workorder-progressive-stack">
      {sections.map((section) => {
        if (section.modulePolicy?.descriptor?.placementBySurface?.create === "supporting") return null;
        const Renderer = createModuleRenderer(section.id, renderers);
        if (!Renderer) return null;
        return <Renderer key={section.id} access={section.access} {...moduleProps[section.id]} />;
      })}
    </div>
  );
}
